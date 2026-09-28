import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getCampaignOwnerId: vi.fn() }))
vi.mock('@/features/campaigns/server/campaign-sending', async (orig) => ({
  ...(await orig<typeof import('@/features/campaigns/server/campaign-sending')>()),
  approveCampaignSample: vi.fn(),
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getCampaignOwnerId } from '@/features/team/server/owners'
import { approveCampaignSample, CampaignNotFoundError } from '@/features/campaigns/server/campaign-sending'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const ctxParam = { params: Promise.resolve({ id: 'c1' }) }
const call = () => POST(new Request('http://x', { method: 'POST' }), ctxParam)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getCampaignOwnerId).mockResolvedValue('m-rep')
})

describe('POST /api/campaigns/[id]/approve-sample', () => {
  it('403 without an org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(403)
  })
  it('returns the queued count', async () => {
    vi.mocked(approveCampaignSample).mockResolvedValue({ queued: 7 })
    const res = await call()
    expect(await res.json()).toEqual({ queued: 7 })
    expect(approveCampaignSample).toHaveBeenCalledWith({ organizationId: 'org-1', campaignId: 'c1', clerkUserId: 'user_rep' })
  })
  it('404 for an unknown campaign', async () => {
    vi.mocked(getCampaignOwnerId).mockResolvedValue(undefined)
    vi.mocked(approveCampaignSample).mockRejectedValue(new CampaignNotFoundError())
    expect((await call()).status).toBe(404)
  })

  it.each([
    ["another rep's campaign", rep, 'm-other', 403],
    ['an unassigned campaign', rep, null, 403],
    ['their own campaign', rep, 'm-rep', 200],
    ['any campaign as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getCampaignOwnerId).mockResolvedValue(ownerId as string | null)
    vi.mocked(approveCampaignSample).mockResolvedValue({ queued: 1 })
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(approveCampaignSample).not.toHaveBeenCalled()
    }
  })
})
