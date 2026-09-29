import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/business-profile/server/rescore', () => ({ rescoreOrganizationLeads: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { rescoreOrganizationLeads } from '@/features/business-profile/server/rescore'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
})

describe('POST /api/settings/business-profile/rescore', () => {
  it('403 without an org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(403)
  })

  it('403 ADMIN_ONLY for a non-admin member, and does not rescore', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(rescoreOrganizationLeads).not.toHaveBeenCalled()
  })

  it('400 on an invalid `since` (not a date)', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ since: 'not-a-date' }) }))
    expect(res.status).toBe(400)
    expect(rescoreOrganizationLeads).not.toHaveBeenCalled()
  })

  it('200 passes { since: Date } through and returns the JSON, org-scoped, for an admin', async () => {
    vi.mocked(rescoreOrganizationLeads).mockResolvedValue({ rescored: 2, remaining: 0, since: '2026-10-01T00:00:00.000Z' })
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ since: '2026-10-01T00:00:00.000Z' }) }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rescored: 2, remaining: 0, since: '2026-10-01T00:00:00.000Z' })
    expect(rescoreOrganizationLeads).toHaveBeenCalledWith('org-1', { since: new Date('2026-10-01T00:00:00.000Z') })
  })

  it('200 with no body/since', async () => {
    vi.mocked(rescoreOrganizationLeads).mockResolvedValue({ rescored: 0, remaining: 0, since: '2026-10-01T00:00:00.000Z' })
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(200)
    expect(rescoreOrganizationLeads).toHaveBeenCalledWith('org-1', { since: undefined })
  })
})
