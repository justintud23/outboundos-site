import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    promptTemplate: { findFirst: vi.fn() },
    lead: { update: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/ai', () => ({
  getAIProvider: vi.fn(() => ({
    scoreLeads: vi.fn(),
    draftEmail: vi.fn(),
    classifyReply: vi.fn(),
  })),
}))

import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { scoreLeads } from './score-leads'

describe('scoreLeads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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

    const mockProvider = { scoreLeads: vi.fn().mockResolvedValueOnce([
      { leadId: 'lead-1', score: 80, reason: 'Senior title at known company' },
    ]), draftEmail: vi.fn(), classifyReply: vi.fn() }
    vi.mocked(getAIProvider).mockReturnValue(mockProvider)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    const results = await scoreLeads({ organizationId: 'org-1', leadIds: ['lead-1'] })

    expect(mockProvider.scoreLeads).toHaveBeenCalledOnce()
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

    const mockProvider = { scoreLeads: vi.fn().mockResolvedValueOnce([
      { leadId: 'lead-2', score: 40, reason: 'Limited info available' },
    ]), draftEmail: vi.fn(), classifyReply: vi.fn() }
    vi.mocked(getAIProvider).mockReturnValue(mockProvider)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    await scoreLeads({ organizationId: 'org-1', leadIds: ['lead-2'] })

    expect(mockProvider.scoreLeads).toHaveBeenCalledWith(
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

    const scoreLeadsMock = vi.fn(async (chunkLeads: Lead[]) => scoreChunk(chunkLeads))
    vi.mocked(getAIProvider).mockReturnValue({ scoreLeads: scoreLeadsMock, draftEmail: vi.fn(), classifyReply: vi.fn() })

    const results = await scoreLeads({ organizationId: 'org-1', leadIds: leads.map((l) => l.id) })

    expect(scoreLeadsMock).toHaveBeenCalledTimes(3)
    const chunkSizes = scoreLeadsMock.mock.calls.map((c) => (c[0] as Lead[]).length).sort((a, b) => b - a)
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
    const scoreLeadsMock = vi.fn(async (chunkLeads: Lead[]) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return scoreChunk(chunkLeads)
    })
    vi.mocked(getAIProvider).mockReturnValue({ scoreLeads: scoreLeadsMock, draftEmail: vi.fn(), classifyReply: vi.fn() })

    await scoreLeads({ organizationId: 'org-1', leadIds: leads.map((l) => l.id) })

    expect(scoreLeadsMock).toHaveBeenCalledTimes(6)
    expect(maxInFlight).toBeLessThanOrEqual(4) // SCORING_CONCURRENCY
    expect(maxInFlight).toBeGreaterThan(1) // proves it actually runs concurrently
  })

  it('isolates a failed chunk: other chunks keep their scores, the failed chunk is unscored', async () => {
    const leads = makeLeads(50) // 2 chunks of 25
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(leads as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(null)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    // First chunk succeeds; second chunk throws (provider transient failure).
    const scoreLeadsMock = vi.fn()
      .mockImplementationOnce(async (chunkLeads: Lead[]) => scoreChunk(chunkLeads))
      .mockRejectedValueOnce(new Error('rate limited'))
    vi.mocked(getAIProvider).mockReturnValue({ scoreLeads: scoreLeadsMock, draftEmail: vi.fn(), classifyReply: vi.fn() })

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
    const scoreLeadsMock = vi.fn(async () => [
      { leadId: 'lead-2', score: 30, reason: 'c' },
      { leadId: 'lead-0', score: 10, reason: 'a' },
      { leadId: 'ghost-999', score: 99, reason: 'hallucinated' },
    ])
    vi.mocked(getAIProvider).mockReturnValue({ scoreLeads: scoreLeadsMock, draftEmail: vi.fn(), classifyReply: vi.fn() })

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

    const scoreLeadsMock = vi.fn(async (chunkLeads: Lead[]) => scoreChunk(chunkLeads))
    vi.mocked(getAIProvider).mockReturnValue({ scoreLeads: scoreLeadsMock, draftEmail: vi.fn(), classifyReply: vi.fn() })

    const results = await scoreLeads({ organizationId: 'org-1', leadIds: leads.map((l) => l.id) })

    expect(scoreLeadsMock).toHaveBeenCalledTimes(1)
    expect((scoreLeadsMock.mock.calls[0]?.[0] as Lead[]).length).toBe(5)
    expect(results).toHaveLength(5)
  })
})
