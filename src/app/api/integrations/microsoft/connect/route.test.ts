import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))

vi.mock('@/features/integrations/server/microsoft', () => ({
  buildAdminConsentUrl: vi.fn(() => 'https://login.microsoftonline.com/organizations/v2.0/adminconsent?state=abc'),
  CONNECT_STATE_COOKIE: 'ms_connect_state',
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { buildAdminConsentUrl } from '@/features/integrations/server/microsoft'
import { GET } from './route'

const mockResolveMember = resolveMember as unknown as ReturnType<typeof vi.fn>
const mockBuildAdminConsentUrl = buildAdminConsentUrl as unknown as ReturnType<typeof vi.fn>

const fakeOrg = { id: 'internal-org-id', clerkId: 'clerk-org-id' }
const admin = { org: fakeOrg, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }
const rep = { org: fakeOrg, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveMember.mockResolvedValue(admin as never)
})

describe('GET /api/integrations/microsoft/connect', () => {
  it('403 without an active org, and does not redirect to Microsoft', async () => {
    mockResolveMember.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(403)
    expect(mockBuildAdminConsentUrl).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member, and does not redirect to Microsoft', async () => {
    mockResolveMember.mockResolvedValue(rep as never)
    const res = await GET()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(mockBuildAdminConsentUrl).not.toHaveBeenCalled()
  })

  it('an admin is redirected to the Microsoft admin-consent URL', async () => {
    const res = await GET()
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://login.microsoftonline.com/organizations/v2.0/adminconsent?state=abc')
    expect(mockBuildAdminConsentUrl).toHaveBeenCalled()
  })
})
