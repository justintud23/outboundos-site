import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { lead: { findMany: vi.fn(), count: vi.fn() } } }))
vi.mock('@/features/leads/server/score-leads', () => ({
  scoreLeads: vi.fn(async ({ leadIds }: { leadIds: string[] }) =>
    leadIds.map((id) => ({ leadId: id, score: 50, reason: '', success: true })),
  ),
}))

import { prisma } from '@/lib/db/prisma'
import { scoreLeads } from '@/features/leads/server/score-leads'
import { rescoreOrganizationLeads } from './rescore'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { lead: { findMany: Fn; count: Fn } }
beforeEach(() => vi.resetAllMocks())

describe('rescoreOrganizationLeads (Review Focus #4)', () => {
  it('rescores leads not yet scored since `since`, oldest first, and reports remaining', async () => {
    const since = new Date('2026-10-01T00:00:00Z')
    p.lead.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]).mockResolvedValueOnce([])
    p.lead.count.mockResolvedValue(0)
    const res = await rescoreOrganizationLeads('org-1', { since, batchSize: 2 })
    expect(p.lead.findMany.mock.calls[0]![0]).toMatchObject({
      where: { organizationId: 'org-1', OR: [{ scoredAt: null }, { scoredAt: { lt: since } }] },
      orderBy: { scoredAt: { sort: 'asc', nulls: 'first' } },
      take: 2,
    })
    expect(scoreLeads).toHaveBeenCalledWith({ organizationId: 'org-1', leadIds: ['a', 'b'] })
    expect(res).toEqual({ rescored: 2, remaining: 0, since: since.toISOString() })
  })

  it('uses default batchSize 50 when not specified', async () => {
    p.lead.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    p.lead.count.mockResolvedValue(0)
    await rescoreOrganizationLeads('org-1')
    expect(p.lead.findMany.mock.calls[0]![0]).toMatchObject({ take: 50 })
  })

  it('stops before starting a batch that would not fit given the slowest batch seen so far (I2 / R-F)', async () => {
    const now = vi.spyOn(Date, 'now')
    now
      .mockReturnValueOnce(0) // startedAt
      .mockReturnValueOnce(0) // elapsed check before batch 1 (elapsed = 0)
      .mockReturnValueOnce(0) // batchStartedAt for batch 1
      .mockReturnValueOnce(35_000) // batch 1 finishes 35s later
      .mockReturnValueOnce(35_000) // elapsed check before batch 2 (elapsed = 35_000)

    p.lead.findMany.mockResolvedValueOnce([{ id: 'a' }])
    p.lead.count.mockResolvedValue(5)
    vi.mocked(scoreLeads).mockResolvedValue([{ leadId: 'a', score: 50, reason: '', success: true }])

    const res = await rescoreOrganizationLeads('org-1', { batchSize: 1, budgetMs: 40_000 })

    // elapsed (35_000) + slowest batch so far (35_000) = 70_000 > budget (40_000),
    // so a second batch must never be started.
    expect(p.lead.findMany).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ rescored: 1, remaining: 5, since: expect.any(String) })
    now.mockRestore()
  })

  it('does not count a lead whose scoreLeads result is not success, and does not refetch it within the same call (I3)', async () => {
    p.lead.findMany.mockResolvedValueOnce([{ id: 'x' }]).mockResolvedValueOnce([])
    p.lead.count.mockResolvedValue(1)
    vi.mocked(scoreLeads).mockResolvedValue([{ leadId: 'x', score: null, reason: 'persist failed', success: false }])

    const res = await rescoreOrganizationLeads('org-1', { batchSize: 1 })

    expect(res.rescored).toBe(0)
    expect(p.lead.findMany).toHaveBeenCalledTimes(2)
    expect(p.lead.findMany.mock.calls[1]![0]).toMatchObject({ where: { id: { notIn: ['x'] } } })
  })

  it('a persistently failing lead never gets counted and remaining stays unchanged across repeated calls, so the client stall guard fires (I3 / T8)', async () => {
    p.lead.findMany
      .mockResolvedValueOnce([{ id: 'x' }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'x' }])
      .mockResolvedValueOnce([])
    p.lead.count.mockResolvedValue(1)
    vi.mocked(scoreLeads).mockResolvedValue([{ leadId: 'x', score: null, reason: 'persist failed', success: false }])

    const first = await rescoreOrganizationLeads('org-1', { batchSize: 1 })
    const second = await rescoreOrganizationLeads('org-1', { batchSize: 1 })

    expect(first).toMatchObject({ rescored: 0, remaining: 1 })
    expect(second).toMatchObject({ rescored: 0, remaining: 1 })
  })
})
