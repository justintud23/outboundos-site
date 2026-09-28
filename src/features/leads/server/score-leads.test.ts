import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    promptTemplate: { findFirst: vi.fn() },
    lead: { update: vi.fn(), findMany: vi.fn() },
  },
}))

// A single shared provider object — tests configure its methods directly
// (e.g. `provider.adjustLeadScores.mockResolvedValue(...)`) rather than each
// swapping in their own object via `getAIProvider.mockReturnValue`.
const { provider } = vi.hoisted(() => ({
  provider: {
    scoreLeads: vi.fn(),
    draftEmail: vi.fn(),
    classifyReply: vi.fn(),
    personalize: vi.fn(),
    adjustLeadScores: vi.fn(),
  },
}))

vi.mock('@/lib/ai', () => ({
  getAIProvider: vi.fn(() => provider),
}))

vi.mock('@/features/business-profile/server/profile', () => ({ getBusinessProfile: vi.fn() }))
vi.mock('@/features/business-profile/server/zip-distance', () => ({ nearestYard: vi.fn(() => ({ miles: 5, radiusMiles: 20 })) }))

import { prisma } from '@/lib/db/prisma'
import { getBusinessProfile } from '@/features/business-profile/server/profile'
import { PRESETS } from '@/features/business-profile/presets'
import { scoreLeads } from './score-leads'

// Applies to every test below (both describe blocks are siblings, not
// nested) — clears call history/results between tests, and keeps the
// default "no profile" behavior unless a test opts into a profile.
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBusinessProfile).mockResolvedValue(null)
})

describe('scoreLeads', () => {

  it('scores leads and persists results', async () => {
    const mockLeads = [
      { id: 'lead-1', email: 'a@test.com', firstName: 'A', lastName: null, company: 'Acme', title: 'VP' },
    ]
    const mockTemplate = {
      id: 'tpl-1',
      body: 'Score this lead 0-100 based on ICP fit.',
    }

    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(mockLeads as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(mockTemplate as never)

    provider.scoreLeads.mockResolvedValueOnce([
      { leadId: 'lead-1', score: 80, reason: 'Senior title at known company' },
    ])
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    const results = await scoreLeads({ organizationId: 'org-1', leadIds: ['lead-1'] })

    expect(provider.scoreLeads).toHaveBeenCalledOnce()
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1', organizationId: 'org-1' },
        data: expect.objectContaining({ score: 80 }),
      }),
    )
    expect(results[0]).toMatchObject({ leadId: 'lead-1', score: 80, success: true })
  })

  it('uses fallback prompt when no PromptTemplate exists', async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([
      { id: 'lead-2', email: 'b@test.com', firstName: null, lastName: null, company: null, title: null },
    ] as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(null)

    provider.scoreLeads.mockResolvedValueOnce([
      { leadId: 'lead-2', score: 40, reason: 'Limited info available' },
    ])
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    await scoreLeads({ organizationId: 'org-1', leadIds: ['lead-2'] })

    expect(provider.scoreLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('ICP'), // fallback prompt contains 'ICP'
    )
  })

  // ─── Chunking + bounded concurrency ───────────────────────────────────────

  type Lead = { id: string; email: string; firstName: null; lastName: null; company: null; title: null }
  function makeLeads(n: number): Lead[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `lead-${i}`, email: `l${i}@t.com`, firstName: null, lastName: null, company: null, title: null,
    }))
  }
  // Score every lead in the given chunk (echoes ids back) — the default "happy" model.
  function scoreChunk(chunkLeads: Lead[]) {
    return chunkLeads.map((l) => ({ leadId: l.id, score: 50, reason: 'ok' }))
  }

  it('splits a large input into bounded chunks, scoring each independently', async () => {
    const leads = makeLeads(60) // 60 / 25 → 3 chunks (25, 25, 10)
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(leads as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    provider.scoreLeads.mockImplementation(async (chunkLeads: Lead[]) => scoreChunk(chunkLeads))

    const results = await scoreLeads({ organizationId: 'org-1', leadIds: leads.map((l) => l.id) })

    expect(provider.scoreLeads).toHaveBeenCalledTimes(3)
    const chunkSizes = provider.scoreLeads.mock.calls.map((c) => (c[0] as Lead[]).length).sort((a, b) => b - a)
    expect(chunkSizes).toEqual([25, 25, 10])
    expect(results).toHaveLength(60)
    expect(results.every((r) => r.score === 50)).toBe(true)
  })

  it('bounds concurrency: never more than SCORING_CONCURRENCY chunks in flight', async () => {
    const leads = makeLeads(150) // 6 chunks
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(leads as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    let inFlight = 0
    let maxInFlight = 0
    provider.scoreLeads.mockImplementation(async (chunkLeads: Lead[]) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return scoreChunk(chunkLeads)
    })

    await scoreLeads({ organizationId: 'org-1', leadIds: leads.map((l) => l.id) })

    expect(provider.scoreLeads).toHaveBeenCalledTimes(6)
    expect(maxInFlight).toBeLessThanOrEqual(4) // SCORING_CONCURRENCY
    expect(maxInFlight).toBeGreaterThan(1) // proves it actually runs concurrently
  })

  it('isolates a failed chunk: other chunks keep their scores, the failed chunk is unscored', async () => {
    const leads = makeLeads(50) // 2 chunks of 25
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(leads as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    // First chunk succeeds; second chunk throws (provider transient failure).
    provider.scoreLeads
      .mockImplementationOnce(async (chunkLeads: Lead[]) => scoreChunk(chunkLeads))
      .mockRejectedValueOnce(new Error('rate limited'))

    const results = await scoreLeads({ organizationId: 'org-1', leadIds: leads.map((l) => l.id) })

    expect(results).toHaveLength(50)
    const scored = results.filter((r) => r.score === 50)
    const failed = results.filter((r) => r.score === null)
    expect(scored).toHaveLength(25)
    expect(failed).toHaveLength(25)
    failed.forEach((r) => expect(r.reason).toMatch(/unscored/i))
  })

  it('maps scores by lead id, not position: reordered/omitted/hallucinated results stay correct', async () => {
    const leads = makeLeads(3) // single chunk: lead-0, lead-1, lead-2
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(leads as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    // Model REORDERS (lead-2 first), OMITS lead-1, and adds a HALLUCINATED id.
    provider.scoreLeads.mockImplementation(async () => [
      { leadId: 'lead-2', score: 30, reason: 'c' },
      { leadId: 'lead-0', score: 10, reason: 'a' },
      { leadId: 'ghost-999', score: 99, reason: 'hallucinated' },
    ])

    const results = await scoreLeads({ organizationId: 'org-1', leadIds: leads.map((l) => l.id) })

    const byId = Object.fromEntries(results.map((r) => [r.leadId, r]))
    expect(byId['lead-0']?.score).toBe(10) // mapped by id, not by being 2nd in the array
    expect(byId['lead-2']?.score).toBe(30)
    expect(byId['lead-1']?.score).toBeNull() // omitted by the model → explicit unscored
    expect(results).toHaveLength(3) // exactly one result per input lead
    expect(byId['ghost-999']).toBeUndefined() // hallucinated id never assigned
  })

  it('small input (< chunk size) scores as a single chunk', async () => {
    const leads = makeLeads(5)
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(leads as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    provider.scoreLeads.mockImplementation(async (chunkLeads: Lead[]) => scoreChunk(chunkLeads))

    const results = await scoreLeads({ organizationId: 'org-1', leadIds: leads.map((l) => l.id) })

    expect(provider.scoreLeads).toHaveBeenCalledTimes(1)
    expect((provider.scoreLeads.mock.calls[0]?.[0] as Lead[]).length).toBe(5)
    expect(results).toHaveLength(5)
  })
})

describe('scoreLeads with a business profile', () => {
  const profile = { ...PRESETS.snow_paving, yards: [{ label: 'Y', zip: '14206', radiusMiles: 20 }] }
  const lead = (id: string, o: Record<string, unknown> = {}) => ({
    id,
    email: `${id}@x.com`,
    firstName: null,
    lastName: null,
    company: 'Acme',
    title: 'Property Manager',
    customFields: { zip: '14210', property_type: 'HOA', sites: '8' },
    ...o,
  })

  beforeEach(() => {
    vi.mocked(getBusinessProfile).mockResolvedValue(profile)
  })

  it('stores rules + AI score, reason and breakdown; does not use the generic prompt', async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValue([lead('l1')] as never)
    provider.adjustLeadScores.mockResolvedValue([{ leadId: 'l1', adjustment: -5, reason: 'Vendor, not owner' }])
    const [r] = await scoreLeads({ organizationId: 'org-1', leadIds: ['l1'] })
    expect(r).toMatchObject({ leadId: 'l1', score: 80, success: true })
    const data = vi.mocked(prisma.lead.update).mock.calls[0]![0].data as Record<string, unknown>
    expect(data.scoreReason).toBe(
      'In area (5 mi) · HOA / community association (great fit) · 8 sites · Decision-maker title · AI -5: Vendor, not owner',
    )
    expect(data.scoreBreakdown).toMatchObject({ rulesScore: 85, cap: null, aiAdjustment: -5, aiReason: 'Vendor, not owner' })
    expect(provider.scoreLeads).not.toHaveBeenCalled()
    expect(prisma.promptTemplate.findFirst).not.toHaveBeenCalled()
  })

  it('never sends capped leads to the AI (Review Focus #2)', async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValue([
      lead('l1', { customFields: { zip: '14210', property_type: 'Single family home' } }),
    ] as never)
    const [r] = await scoreLeads({ organizationId: 'org-1', leadIds: ['l1'] })
    expect(r!.score).toBe(10)
    expect(provider.adjustLeadScores).not.toHaveBeenCalled()
  })

  it('keeps the rules score when the AI chunk fails', async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValue([lead('l1')] as never)
    provider.adjustLeadScores.mockRejectedValue(new Error('boom'))
    const [r] = await scoreLeads({ organizationId: 'org-1', leadIds: ['l1'] })
    expect(r!.score).toBe(85)
    expect(vi.mocked(prisma.lead.update).mock.calls[0]![0].data.scoreReason).toContain('AI adjustment skipped')
  })

  it('clamps the final score to 0..100 and a missing adjustment counts as skipped', async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValue([
      lead('l1', { customFields: { zip: '14210', property_type: 'HOA', sites: '8', relationship: 'customer' } }),
      lead('l2'),
    ] as never)
    provider.adjustLeadScores.mockResolvedValue([{ leadId: 'l1', adjustment: 15, reason: 'Big portfolio' }])
    const results = await scoreLeads({ organizationId: 'org-1', leadIds: ['l1', 'l2'] })
    expect(results.find((x) => x.leadId === 'l1')!.score).toBe(100)
    expect(
      vi.mocked(prisma.lead.update).mock.calls.find((c) => c[0].where.id === 'l2')![0].data.scoreReason,
    ).toContain('AI adjustment skipped')
  })
})
