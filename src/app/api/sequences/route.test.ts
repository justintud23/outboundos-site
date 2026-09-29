import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getCampaignOwnerId: vi.fn() }))
vi.mock('@/features/sequences/server/create-sequence', () => ({ createSequence: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getCampaignOwnerId } from '@/features/team/server/owners'
import { POST } from './route'
import { createSequence } from '@/features/sequences/server/create-sequence'
import { ContentHighRiskError } from '@/features/content-check/types'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const VALID_BODY = { campaignId: 'camp-1', name: 'Seq', steps: [{ stepNumber: 1, subject: 's', body: 'b', delayDays: 0 }] }

const call = (body: unknown = VALID_BODY) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getCampaignOwnerId).mockResolvedValue('m-rep')
  vi.mocked(createSequence).mockResolvedValue({ id: 'seq-1' } as never)
})

describe('POST /api/sequences', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('400 when campaignId, name, or steps are missing', async () => {
    const res = await call({ name: 'Seq' })
    expect(res.status).toBe(400)
    expect(getCampaignOwnerId).not.toHaveBeenCalled()
  })

  it('returns 422 CONTENT_HIGH_RISK with findings', async () => {
    vi.mocked(createSequence).mockRejectedValue(new ContentHighRiskError([{ key: 'step:s:1', label: 'Fall — step 1', subject: 'Re: hi', body: '', isFirstStep: true, level: 'HIGH', findings: [] }]))
    const res = await call()
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('CONTENT_HIGH_RISK')
    expect(body.findings[0].key).toBe('step:s:1')
  })

  it.each([
    ["another rep's campaign", rep, 'm-other', 403],
    ['an unassigned campaign', rep, null, 403],
    ['their own campaign', rep, 'm-rep', 201],
    ['any campaign as admin', admin, 'm-other', 201],
  ])('member creating a sequence on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getCampaignOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(createSequence).not.toHaveBeenCalled()
    }
  })

  it('looks up ownership keyed on body.campaignId', async () => {
    await call({ ...VALID_BODY, campaignId: 'camp-42' })
    expect(getCampaignOwnerId).toHaveBeenCalledWith('org-1', 'camp-42')
  })
})
