import crypto from 'node:crypto'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SalesforceApiError, SalesforceAuthError } from './errors'

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'))
  vi.stubEnv('SALESFORCE_CLIENT_ID', 'client-id-123')
  vi.stubEnv('SALESFORCE_CLIENT_SECRET', 'client-secret-456')
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com')
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('signState / verifyState', () => {
  it('round-trips {orgId, memberId, env}', async () => {
    const { signState, verifyState } = await import('./oauth')
    const now = Date.now()
    const token = signState({ orgId: 'org-1', memberId: 'mem-1', env: 'production' }, now)
    const state = verifyState(token, now)
    expect(state).not.toBeNull()
    expect(state?.orgId).toBe('org-1')
    expect(state?.memberId).toBe('mem-1')
    expect(state?.env).toBe('production')
  })

  it('returns null after 10 minutes', async () => {
    const { signState, verifyState } = await import('./oauth')
    const now = Date.now()
    const token = signState({ orgId: 'org-1', memberId: 'mem-1', env: 'production' }, now)
    expect(verifyState(token, now + 600_001)).toBeNull()
  })

  it('returns null when one character of the payload is changed', async () => {
    const { signState, verifyState } = await import('./oauth')
    const now = Date.now()
    const token = signState({ orgId: 'org-1', memberId: 'mem-1', env: 'production' }, now)
    const [body, sig] = token.split('.')
    const tampered = body.slice(0, -1) + (body.at(-1) === 'a' ? 'b' : 'a')
    expect(verifyState(`${tampered}.${sig}`, now)).toBeNull()
  })

  it('returns null when one character of the signature is changed', async () => {
    const { signState, verifyState } = await import('./oauth')
    const now = Date.now()
    const token = signState({ orgId: 'org-1', memberId: 'mem-1', env: 'production' }, now)
    const [body, sig] = token.split('.')
    const tampered = sig.slice(0, -1) + (sig.at(-1) === 'a' ? 'b' : 'a')
    expect(verifyState(`${body}.${tampered}`, now)).toBeNull()
  })

  it('returns null for garbage input', async () => {
    const { verifyState } = await import('./oauth')
    expect(verifyState('not-a-real-token', Date.now())).toBeNull()
    expect(verifyState('', Date.now())).toBeNull()
  })
})

describe('createPkcePair', () => {
  it('the challenge equals base64url(sha256(verifier)), and the verifier is 43+ chars', async () => {
    const { createPkcePair } = await import('./oauth')
    const { verifier, challenge } = createPkcePair()
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    const expected = crypto.createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
  })
})

describe('buildAuthorizeUrl', () => {
  it('builds the sandbox authorize URL with the expected params', async () => {
    const { buildAuthorizeUrl } = await import('./oauth')
    const url = new URL(
      buildAuthorizeUrl({ env: 'sandbox', state: 'the-state', challenge: 'the-challenge' }),
    )
    expect(`${url.protocol}//${url.host}${url.pathname}`).toBe(
      'https://test.salesforce.com/services/oauth2/authorize',
    )
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('client_id')).toBe('client-id-123')
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://app.example.com/api/integrations/salesforce/callback',
    )
    expect(url.searchParams.get('scope')).toBe('api refresh_token id')
    expect(url.searchParams.get('state')).toBe('the-state')
    expect(url.searchParams.get('code_challenge')).toBe('the-challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })
})

describe('exchangeCode', () => {
  it('POSTs form-encoded params to <host>/services/oauth2/token and maps the response', async () => {
    const { exchangeCode } = await import('./oauth')
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'at-1',
        refresh_token: 'rt-1',
        instance_url: 'https://my.salesforce.com',
        id: 'https://login.salesforce.com/id/00D/005',
      }),
    })

    const result = await exchangeCode({ env: 'production', code: 'the-code', verifier: 'the-verifier' })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('https://login.salesforce.com/services/oauth2/token')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams(init.body)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('client_id')).toBe('client-id-123')
    expect(body.get('client_secret')).toBe('client-secret-456')
    expect(body.get('redirect_uri')).toBe('https://app.example.com/api/integrations/salesforce/callback')
    expect(body.get('code_verifier')).toBe('the-verifier')

    expect(result).toEqual({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      instanceUrl: 'https://my.salesforce.com',
      idUrl: 'https://login.salesforce.com/id/00D/005',
    })
  })

  it('throws SalesforceApiError on a non-2xx response, carrying error_description', async () => {
    const { exchangeCode } = await import('./oauth')
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'expired authorization code' }),
    })

    await expect(
      exchangeCode({ env: 'production', code: 'bad-code', verifier: 'v' }),
    ).rejects.toThrow(SalesforceApiError)
    await expect(
      exchangeCode({ env: 'production', code: 'bad-code', verifier: 'v' }),
    ).rejects.toThrow('expired authorization code')
  })
})

describe('fetchIdentity', () => {
  it('GETs the id URL with a Bearer token and maps the response', async () => {
    const { fetchIdentity } = await import('./oauth')
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: '005xx',
        organization_id: '00Dxx',
        username: 'admin@example.com',
        email: 'admin@example.com',
      }),
    })

    const result = await fetchIdentity('https://login.salesforce.com/id/00D/005', 'at-1')

    expect(mockFetch).toHaveBeenCalledWith('https://login.salesforce.com/id/00D/005', {
      headers: { Authorization: 'Bearer at-1' },
    })
    expect(result).toEqual({
      userId: '005xx',
      orgId: '00Dxx',
      username: 'admin@example.com',
      email: 'admin@example.com',
    })
  })
})

describe('refreshAccessToken', () => {
  it('throws SalesforceAuthError on a 400 invalid_grant', async () => {
    const { refreshAccessToken } = await import('./oauth')
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'expired access/refresh token' }),
    })

    await expect(refreshAccessToken('https://login.salesforce.com', 'rt-1')).rejects.toThrow(
      SalesforceAuthError,
    )
  })

  it('maps access_token and instance_url on success', async () => {
    const { refreshAccessToken } = await import('./oauth')
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'at-2', instance_url: 'https://my.salesforce.com' }),
    })

    const result = await refreshAccessToken('https://login.salesforce.com', 'rt-1')
    expect(result).toEqual({ accessToken: 'at-2', instanceUrl: 'https://my.salesforce.com' })
  })
})
