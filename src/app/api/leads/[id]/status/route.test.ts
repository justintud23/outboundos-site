import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getLeadOwnerId: vi.fn() }))
vi.mock('@/features/leads/server/update-lead-status', () => ({ updateLeadStatus: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getLeadOwnerId } from '@/features/team/server/owners'
import { updateLeadStatus } from '@/features/leads/server/update-lead-status'
import { LeadNotFoundError } from '@/features/leads/types'
import { PATCH } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown = { status: 'CONTACTED' }) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'lead-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getLeadOwnerId).mockResolvedValue('m-rep')
  vi.mocked(updateLeadStatus).mockResolvedValue({ id: 'lead-1', status: 'CONTACTED' } as never)
})

describe('PATCH /api/leads/[id]/status', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('400 for an invalid status', async () => {
    const res = await call({ status: 'MADE_UP' })
    expect(res.status).toBe(400)
    expect(updateLeadStatus).not.toHaveBeenCalled()
  })

  it('404 when the lead is not found', async () => {
    vi.mocked(updateLeadStatus).mockRejectedValue(new LeadNotFoundError())
    expect((await call()).status).toBe(404)
  })

  it.each([
    ["another rep's lead", rep, 'm-other', 403],
    ['an unassigned lead', rep, null, 403],
    ['their own lead', rep, 'm-rep', 200],
    ['any lead as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getLeadOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(updateLeadStatus).not.toHaveBeenCalled()
    }
  })

  it('updates with the caller\'s clerkUserId as actor', async () => {
    await call()
    expect(updateLeadStatus).toHaveBeenCalledWith({
      organizationId: 'org-1',
      leadId: 'lead-1',
      newStatus: 'CONTACTED',
      actorClerkId: 'user_rep',
    })
  })
})
