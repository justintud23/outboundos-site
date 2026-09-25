import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { campaign: { findFirst: vi.fn(), update: vi.fn() } } }))

import { prisma } from '@/lib/db/prisma'
import { assertContentAllowed, contentHash, loadCampaignContent, recordContentOverride, getCampaignContentStatus } from './content-gate'
import { ContentHighRiskError, ContentOverrideValidationError } from '../types'
import { stepItems } from '../campaign-content'

type Fn = ReturnType<typeof vi.fn>
const find = (prisma as unknown as { campaign: { findFirst: Fn; update: Fn } }).campaign.findFirst

const GOOD = 'Hi {firstName|there},\n\n{personalization}\n\nWe handle plowing, salting and sealcoating for commercial lots across Buffalo. Would a quick quote for next season help?\n\nThanks'
const campaign = (o: Record<string, unknown> = {}) => ({
  id: 'camp-1', autoSend: true, contentOverrideHash: null, contentOverrideReason: null, contentOverrideBy: null, contentOverrideAt: null,
  organization: { guardrailBlockedPhrases: [], guardrailAllowedWords: [] },
  sequences: [{
    id: 'seq-1', name: 'Fall',
    steps: [{ id: 'st-1', stepNumber: 1, subject: 'Snow plan', body: GOOD, subjectVariants: [{ id: 'v-1', subject: 'Quick question' }] }],
  }],
  ...o,
})

beforeEach(() => vi.resetAllMocks())

describe('loadCampaignContent', () => {
  it('loads steps and only non-archived variants (Review Focus #5)', async () => {
    find.mockResolvedValue(campaign())
    const loaded = await loadCampaignContent('org-1', 'camp-1')
    expect(find.mock.calls[0]![0]).toMatchObject({
      where: { id: 'camp-1', organizationId: 'org-1' },
      select: { sequences: { select: { steps: { select: { subjectVariants: { where: { isArchived: false } } } } } } },
    })
    expect(loaded!.items.map((i) => i.key)).toEqual(['step:seq-1:1', 'variant:seq-1:v-1'])
  })

  it('returns null for another org\'s campaign', async () => {
    find.mockResolvedValue(null)
    expect(await loadCampaignContent('org-1', 'nope')).toBeNull()
  })
})

describe('assertContentAllowed', () => {
  it('allows LOW content', async () => {
    find.mockResolvedValue(campaign())
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', enablingAutoSend: true })).resolves.toBeUndefined()
  })

  it('allows a campaign with no sequences (Review Focus #5)', async () => {
    find.mockResolvedValue(campaign({ sequences: [] }))
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', enablingAutoSend: true })).resolves.toBeUndefined()
  })

  it('refuses enabling auto-send while a step is HIGH', async () => {
    find.mockResolvedValue(campaign({ autoSend: false, sequences: [{ id: 'seq-1', name: 'Fall', steps: [{ id: 'st-1', stepNumber: 1, subject: 'Re: your lot', body: GOOD, subjectVariants: [] }] }] }))
    const err = await assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', enablingAutoSend: true }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContentHighRiskError)
    expect((err as ContentHighRiskError).items.map((i) => i.key)).toEqual(['step:seq-1:1'])
  })

  it('does not gate edits to a campaign that is not auto-sending', async () => {
    find.mockResolvedValue(campaign({ autoSend: false }))
    const apply = (items: ReturnType<typeof stepItems>) => [...items, ...stepItems('new', 'New', [{ stepNumber: 1, subject: 'Re: hi', body: GOOD }])]
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', apply })).resolves.toBeUndefined()
  })

  it('refuses a HIGH edit on a live campaign, evaluating the edit applied', async () => {
    find.mockResolvedValue(campaign())
    const apply = (items: ReturnType<typeof stepItems>) => items.map((i) => (i.key === 'variant:seq-1:v-1' ? { ...i, subject: 'Re: hi' } : i))
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', apply })).rejects.toBeInstanceOf(ContentHighRiskError)
  })

  it('honors an override recorded on the saved content, and refuses a further HIGH edit with the edit-context message (I-2)', async () => {
    const high = campaign({ sequences: [{ id: 'seq-1', name: 'Fall', steps: [{ id: 'st-1', stepNumber: 1, subject: 'Re: your lot', body: GOOD, subjectVariants: [] }] }] })
    find.mockResolvedValueOnce(high)
    const saved = (await loadCampaignContent('org-1', 'camp-1'))!.items
    // The override hash is computed from the SAVED content only, exactly as recordContentOverride does it.
    const overrideHash = contentHash(saved)
    find.mockResolvedValue({ ...high, contentOverrideHash: overrideHash, contentOverrideReason: 'Existing customer thread' })

    // (a) enabling auto-send against the unchanged saved HIGH content, with a matching override, resolves.
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', enablingAutoSend: true })).resolves.toBeUndefined()

    // (b) a further HIGH edit no longer matches the recorded override hash and is refused with the 'edit' message.
    const apply = (xs: typeof saved) => xs.map((i) => ({ ...i, subject: 'RE: your lot!!' }))
    const err = await assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', apply }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContentHighRiskError)
    expect((err as ContentHighRiskError).context).toBe('edit')
    expect((err as ContentHighRiskError).message).toBe(
      'High spam risk in Fall — step 1. This campaign is sending automatically: fix the flagged content, or pause automatic sending, save, then record an override on the campaign page.',
    )
  })

  it('contentHash is order-independent and content-sensitive', () => {
    const a = stepItems('s', 'S', [{ stepNumber: 1, subject: 'A', body: 'x' }, { stepNumber: 2, subject: 'B', body: 'y' }])
    expect(contentHash(a)).toBe(contentHash([...a].reverse()))
    expect(contentHash(a)).not.toBe(contentHash(a.map((i) => ({ ...i, body: `${i.body}!` }))))
    expect(contentHash(a)).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('recordContentOverride', () => {
  const update = () => (prisma as unknown as { campaign: { update: Fn } }).campaign.update

  it.each(['short', '   ', 'x'.repeat(501)])('rejects reason %j', async (reason) => {
    find.mockResolvedValue(campaign())
    await expect(recordContentOverride({ organizationId: 'org-1', campaignId: 'camp-1', clerkUserId: 'user_1', reason })).rejects.toBeInstanceOf(ContentOverrideValidationError)
  })

  it('stores the trimmed reason, user, time and current content hash', async () => {
    find.mockResolvedValue(campaign())
    update().mockResolvedValue({})
    await recordContentOverride({ organizationId: 'org-1', campaignId: 'camp-1', clerkUserId: 'user_1', reason: '  Reviewed with legal; keep the wording.  ' })
    const data = update().mock.calls[0]![0].data
    expect(data).toMatchObject({ contentOverrideReason: 'Reviewed with legal; keep the wording.', contentOverrideBy: 'user_1', contentOverrideAt: expect.any(Date) })
    expect(data.contentOverrideHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns null for a missing campaign', async () => {
    find.mockResolvedValue(null)
    expect(await recordContentOverride({ organizationId: 'org-1', campaignId: 'x', clerkUserId: 'u', reason: 'long enough reason' })).toBeNull()
  })
})

describe('getCampaignContentStatus', () => {
  it('reports the level, items and whether the override still matches', async () => {
    find.mockResolvedValue(campaign({ contentOverrideHash: 'stale', contentOverrideReason: 'Old reason here', contentOverrideAt: new Date('2026-09-20T00:00:00Z'), contentOverrideBy: 'user_1' }))
    const status = await getCampaignContentStatus('org-1', 'camp-1')
    expect(status!.level).toBe('LOW')
    expect(status!.items).toHaveLength(2)
    expect(status!.override).toEqual({ reason: 'Old reason here', by: 'user_1', at: '2026-09-20T00:00:00.000Z', valid: false })
  })
})

describe('ContentHighRiskError messages (I-2)', () => {
  const items = stepItems('seq-1', 'Fall', [{ stepNumber: 1, subject: 'Re: your lot', body: GOOD }]).map((i) => ({ ...i, level: 'HIGH' as const, findings: [] }))

  it('defaults to the enable-context message', () => {
    const err = new ContentHighRiskError(items)
    expect(err.context).toBe('enable')
    expect(err.message).toBe('High spam risk in Fall — step 1. Fix the flagged content, or record an override on the campaign page.')
  })

  it('uses the enable-context message when context is "enable"', () => {
    const err = new ContentHighRiskError(items, 'enable')
    expect(err.context).toBe('enable')
    expect(err.message).toBe('High spam risk in Fall — step 1. Fix the flagged content, or record an override on the campaign page.')
  })

  it('uses the edit-context message when context is "edit"', () => {
    const err = new ContentHighRiskError(items, 'edit')
    expect(err.context).toBe('edit')
    expect(err.message).toBe(
      'High spam risk in Fall — step 1. This campaign is sending automatically: fix the flagged content, or pause automatic sending, save, then record an override on the campaign page.',
    )
  })
})
