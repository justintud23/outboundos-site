import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { campaign: { findFirst: vi.fn() } } }))

import { prisma } from '@/lib/db/prisma'
import { assertContentAllowed, contentHash, loadCampaignContent } from './content-gate'
import { ContentHighRiskError } from '../types'
import { stepItems } from '../campaign-content'

type Fn = ReturnType<typeof vi.fn>
const find = (prisma as unknown as { campaign: { findFirst: Fn } }).campaign.findFirst

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

  it('honors an override whose hash matches the content being saved, and rejects it after a further change', async () => {
    const high = campaign({ sequences: [{ id: 'seq-1', name: 'Fall', steps: [{ id: 'st-1', stepNumber: 1, subject: 'Re: your lot', body: GOOD, subjectVariants: [] }] }] })
    const items = (await (async () => { find.mockResolvedValueOnce(high); return (await loadCampaignContent('org-1', 'camp-1'))!.items })())
    find.mockResolvedValue({ ...high, contentOverrideHash: contentHash(items), contentOverrideReason: 'Existing customer thread' })
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', enablingAutoSend: true })).resolves.toBeUndefined()
    const apply = (xs: typeof items) => xs.map((i) => ({ ...i, subject: 'RE: your lot!!' }))
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', apply })).rejects.toBeInstanceOf(ContentHighRiskError)
  })

  it('contentHash is order-independent and content-sensitive', () => {
    const a = stepItems('s', 'S', [{ stepNumber: 1, subject: 'A', body: 'x' }, { stepNumber: 2, subject: 'B', body: 'y' }])
    expect(contentHash(a)).toBe(contentHash([...a].reverse()))
    expect(contentHash(a)).not.toBe(contentHash(a.map((i) => ({ ...i, body: `${i.body}!` }))))
    expect(contentHash(a)).toMatch(/^[0-9a-f]{64}$/)
  })
})
