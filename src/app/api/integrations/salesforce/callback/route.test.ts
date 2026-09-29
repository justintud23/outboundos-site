import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))

const mockCookieGet = vi.fn()
const mockCookieDelete = vi.fn()
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: mockCookieGet, delete: mockCookieDelete }),
}))

vi.mock('@/features/salesforce/server/oauth', () => ({
  verifyState: vi.fn(),
  exchangeCode: vi.fn(),
  fetchIdentity: vi.fn(),
  SF_PKCE_COOKIE: 'sf_pkce',
}))

vi.mock('@/features/salesforce/server/connection', () => ({
  saveConnection: vi.fn(),
}))

vi.mock('@/features/salesforce/config', () => ({
  loginHostFor: vi.fn((env: string) => (env === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com')),
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { verifyState, exchangeCode, fetchIdentity } from '@/features/salesforce/server/oauth'
import { saveConnection } from '@/features/salesforce/server/connection'
import { GET } from './route'

const mockResolveMember = resolveMember as unknown as ReturnType<typeof vi.fn>
const mockVerifyState = verifyState as unknown as ReturnType<typeof vi.fn>
const mockExchangeCode = exchangeCode as unknown as ReturnType<typeof vi.fn>
const mockFetchIdentity = fetchIdentity as unknown as ReturnType<typeof vi.fn>
const mockSaveConnection = saveConnection as unknown as ReturnType<typeof vi.fn>

const fakeOrg = { id: 'org-1' }
const admin = { org: fakeOrg, member: { id: 'mem-admin' }, isAdmin: true }
const rep = { org: fakeOrg, member: { id: 'mem-rep' }, isAdmin: false }

function makeRequest(query: string): Request {
  return new Request(`https://app.test/api/integrations/salesforce/callback${query}`)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveMember.mockResolvedValue(admin as never)
  mockCookieGet.mockReturnValue({ value: 'the-verifier' })
  mockVerifyState.mockReturnValue({ orgId: 'org-1', memberId: 'mem-admin', env: 'production', nonce: 'n', exp: 0 })
  mockExchangeCode.mockResolvedValue({
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    instanceUrl: 'https://my.salesforce.com',
    idUrl: 'https://login.salesforce.com/id/00D/005',
  })
  mockFetchIdentity.mockResolvedValue({
    userId: '005xx',
    orgId: '00Dxx',
    username: 'admin@example.com',
    email: 'admin@example.com',
  })
  mockSaveConnection.mockResolvedValue({ orgChanged: false })
})

describe('GET /api/integrations/salesforce/callback', () => {
  it('redirects to reason=denied when the query has an error, and deletes the PKCE cookie', async () => {
    const res = await GET(makeRequest('?error=access_denied'))
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=error&reason=denied')
    expect(mockCookieDelete).toHaveBeenCalledWith('sf_pkce')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  it('redirects to reason=not_admin when there is no active org', async () => {
    mockResolveMember.mockResolvedValue(null)
    const res = await GET(makeRequest('?code=abc&state=st'))
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=error&reason=not_admin')
    expect(mockCookieDelete).toHaveBeenCalledWith('sf_pkce')
  })

  it('redirects to reason=not_admin for a non-admin member', async () => {
    mockResolveMember.mockResolvedValue(rep as never)
    const res = await GET(makeRequest('?code=abc&state=st'))
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=error&reason=not_admin')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  it('redirects to reason=state when verifyState returns null', async () => {
    mockVerifyState.mockReturnValue(null)
    const res = await GET(makeRequest('?code=abc&state=bad-state'))
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=error&reason=state')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  it('redirects to reason=state when state.orgId does not match ctx.org.id', async () => {
    mockVerifyState.mockReturnValue({ orgId: 'some-other-org', memberId: 'mem-admin', env: 'production', nonce: 'n', exp: 0 })
    const res = await GET(makeRequest('?code=abc&state=st'))
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=error&reason=state')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  it('redirects to reason=pkce when the cookie is missing', async () => {
    mockCookieGet.mockReturnValue(undefined)
    const res = await GET(makeRequest('?code=abc&state=st'))
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=error&reason=pkce')
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })

  it('redirects to reason=exchange and logs when exchangeCode throws', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockExchangeCode.mockRejectedValue(new Error('boom'))
    const res = await GET(makeRequest('?code=abc&state=st'))
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=error&reason=exchange')
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('redirects to reason=exchange when fetchIdentity throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockFetchIdentity.mockRejectedValue(new Error('boom'))
    const res = await GET(makeRequest('?code=abc&state=st'))
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=error&reason=exchange')
  })

  it('redirects to reason=exchange when saveConnection throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSaveConnection.mockRejectedValue(new Error('boom'))
    const res = await GET(makeRequest('?code=abc&state=st'))
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=error&reason=exchange')
  })

  it('calls saveConnection with the mapped values and redirects to connected on success', async () => {
    const res = await GET(makeRequest('?code=abc&state=st'))

    expect(mockSaveConnection).toHaveBeenCalledWith('org-1', 'mem-admin', {
      instanceUrl: 'https://my.salesforce.com',
      loginHost: 'https://login.salesforce.com',
      sfOrgId: '00Dxx',
      sfUserId: '005xx',
      sfUsername: 'admin@example.com',
      sfUserEmail: 'admin@example.com',
      refreshToken: 'rt-1',
    })
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=connected')
    expect(mockCookieDelete).toHaveBeenCalledWith('sf_pkce')
  })

  it('redirects to connected_new_org when saveConnection reports orgChanged', async () => {
    mockSaveConnection.mockResolvedValue({ orgChanged: true })
    const res = await GET(makeRequest('?code=abc&state=st'))
    expect(res.headers.get('location')).toBe('https://app.test/settings?salesforce=connected_new_org')
  })

  it('a member never reaches exchangeCode', async () => {
    mockResolveMember.mockResolvedValue(rep as never)
    await GET(makeRequest('?code=abc&state=st'))
    expect(mockExchangeCode).not.toHaveBeenCalled()
  })
})
