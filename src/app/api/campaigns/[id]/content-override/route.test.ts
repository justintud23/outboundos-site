import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getCampaignOwnerId: vi.fn() }))
vi.mock('@/features/content-check/server/content-gate', () => ({ recordContentOverride: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getCampaignOwnerId } from '@/features/team/server/owners'
import { recordContentOverride } from '@/features/content-check/server/content-gate'
import { ContentOverrideValidationError } from '@/features/content-check/types'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'camp-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getCampaignOwnerId).mockResolvedValue('m-rep')
})

describe('POST /api/campaigns/[id]/content-override', () => {
  it('403 without an org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call({ reason: 'long enough reason' })).status).toBe(403)
  })

  it('400 without a reason, and on a validation error', async () => {
    expect((await call({})).status).toBe(400)
    vi.mocked(recordContentOverride).mockRejectedValue(new ContentOverrideValidationError('Give a reason of 10–500 characters.'))
    expect((await call({ reason: 'short' })).status).toBe(400)
  })

  it('404 for another org\'s campaign', async () => {
    vi.mocked(getCampaignOwnerId).mockResolvedValue(undefined)
    vi.mocked(recordContentOverride).mockResolvedValue(null)
    expect((await call({ reason: 'long enough reason' })).status).toBe(404)
  })

  it('200 records the override org-scoped with the signed-in user', async () => {
    vi.mocked(recordContentOverride).mockResolvedValue({ level: 'HIGH', items: [], override: { reason: 'long enough reason', by: 'user_rep', at: '2026-10-01T00:00:00.000Z', valid: true } })
    const res = await call({ reason: 'long enough reason' })
    expect(res.status).toBe(200)
    expect(recordContentOverride).toHaveBeenCalledWith({ organizationId: 'org-1', campaignId: 'camp-1', clerkUserId: 'user_rep', reason: 'long enough reason' })
  })

  it.each([
    ["another rep's campaign", rep, 'm-other', 403],
    ['an unassigned campaign', rep, null, 403],
    ['their own campaign', rep, 'm-rep', 200],
    ['any campaign as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getCampaignOwnerId).mockResolvedValue(ownerId as string | null)
    vi.mocked(recordContentOverride).mockResolvedValue({ level: 'HIGH', items: [], override: { reason: 'long enough reason', by: 'user_rep', at: '2026-10-01T00:00:00.000Z', valid: true } })
    const res = await call({ reason: 'long enough reason' })
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(recordContentOverride).not.toHaveBeenCalled()
    }
  })
})
