import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))

vi.mock('@/features/salesforce/server/oauth', () => ({
  createPkcePair: vi.fn(),
  signState: vi.fn(),
  buildAuthorizeUrl: vi.fn(),
  SF_PKCE_COOKIE: 'sf_pkce',
  SF_PKCE_COOKIE_PATH: '/api/integrations/salesforce/callback',
}))

vi.mock('@/features/salesforce/config', () => ({
  getSalesforceAppConfig: vi.fn(),
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { createPkcePair, signState, buildAuthorizeUrl } from '@/features/salesforce/server/oauth'
import { getSalesforceAppConfig } from '@/features/salesforce/config'
import { GET } from './route'

const mockResolveMember = resolveMember as unknown as ReturnType<typeof vi.fn>
const mockCreatePkcePair = createPkcePair as unknown as ReturnType<typeof vi.fn>
const mockSignState = signState as unknown as ReturnType<typeof vi.fn>
const mockBuildAuthorizeUrl = buildAuthorizeUrl as unknown as ReturnType<typeof vi.fn>
const mockGetSalesforceAppConfig = getSalesforceAppConfig as unknown as ReturnType<typeof vi.fn>

const fakeOrg = { id: 'org-1' }
const admin = { org: fakeOrg, member: { id: 'mem-admin' }, isAdmin: true }
const rep = { org: fakeOrg, member: { id: 'mem-rep' }, isAdmin: false }

function makeRequest(query = ''): Request {
  return new Request(`https://app.test/api/integrations/salesforce/connect${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveMember.mockResolvedValue(admin as never)
  mockGetSalesforceAppConfig.mockReturnValue({ clientId: 'id', clientSecret: 'secret' })
  mockCreatePkcePair.mockReturnValue({ verifier: 'the-verifier', challenge: 'the-challenge' })
  mockSignState.mockReturnValue('the-state')
  mockBuildAuthorizeUrl.mockReturnValue('https://login.salesforce.com/services/oauth2/authorize?state=the-state')
})

describe('GET /api/integrations/salesforce/connect', () => {
  it('403 without an active org', async () => {
    mockResolveMember.mockResolvedValue(null)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'No active organization.' })
    expect(mockSignState).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member', async () => {
    mockResolveMember.mockResolvedValue(rep as never)
    const res = await GET(makeRequest())
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(mockSignState).not.toHaveBeenCalled()
  })

  it('redirects to /settings?salesforce=error&reason=not_configured when Salesforce is not configured', async () => {
    mockGetSalesforceAppConfig.mockReturnValue(null)
    const res = await GET(makeRequest())
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=error&reason=not_configured')
    expect(mockSignState).not.toHaveBeenCalled()
  })

  it('defaults env to production when the query param is missing or invalid', async () => {
    await GET(makeRequest())
    expect(mockSignState).toHaveBeenCalledWith({ orgId: 'org-1', memberId: 'mem-admin', env: 'production' })

    mockSignState.mockClear()
    await GET(makeRequest('?env=bogus'))
    expect(mockSignState).toHaveBeenCalledWith({ orgId: 'org-1', memberId: 'mem-admin', env: 'production' })
  })

  it('passes sandbox through when requested', async () => {
    await GET(makeRequest('?env=sandbox'))
    expect(mockSignState).toHaveBeenCalledWith({ orgId: 'org-1', memberId: 'mem-admin', env: 'sandbox' })
  })

  it('redirects an admin to buildAuthorizeUrl(...) and sets the PKCE cookie', async () => {
    const res = await GET(makeRequest())

    expect(mockCreatePkcePair).toHaveBeenCalled()
    expect(mockBuildAuthorizeUrl).toHaveBeenCalledWith({
      env: 'production',
      state: 'the-state',
      challenge: 'the-challenge',
    })
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe(
      'https://login.salesforce.com/services/oauth2/authorize?state=the-state',
    )

    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('sf_pkce=the-verifier')
    // Scoped to the callback path exactly, not the wider /api/integrations/salesforce
    // prefix — the callback route deletes with this same path (see Important #1).
    expect(setCookie).toContain('Path=/api/integrations/salesforce/callback')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
    expect(setCookie).toContain('Max-Age=600')
  })
})
