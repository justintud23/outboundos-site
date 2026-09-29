import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getCampaignOwnerId: vi.fn() }))
vi.mock('@/features/campaigns/server/campaign-sending', async (orig) => ({
  ...(await orig<typeof import('@/features/campaigns/server/campaign-sending')>()),
  updateCampaignSending: vi.fn(),
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getCampaignOwnerId } from '@/features/team/server/owners'
import { PATCH } from './route'
import { updateCampaignSending } from '@/features/campaigns/server/campaign-sending'
import { ContentHighRiskError } from '@/features/content-check/types'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown = { autoSend: true }) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'camp-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getCampaignOwnerId).mockResolvedValue('m-rep')
  vi.mocked(updateCampaignSending).mockResolvedValue({ id: 'camp-1', autoSend: true, sampleSize: 10, sampleApprovedAt: null } as never)
})

describe('PATCH /api/campaigns/[id]', () => {
  it('returns 422 CONTENT_HIGH_RISK with findings', async () => {
    vi.mocked(updateCampaignSending).mockRejectedValue(new ContentHighRiskError([{ key: 'step:s:1', label: 'Fall — step 1', subject: 'Re: hi', body: '', isFirstStep: true, level: 'HIGH', findings: [] }]))
    const res = await call()
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('CONTENT_HIGH_RISK')
    expect(body.findings[0].key).toBe('step:s:1')
  })

  it('403 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(403)
  })

  it.each([
    ["another rep's campaign", rep, 'm-other', 403],
    ['an unassigned campaign', rep, null, 403],
    ['their own campaign', rep, 'm-rep', 200],
    ['any campaign as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getCampaignOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(updateCampaignSending).not.toHaveBeenCalled()
    }
  })
})
