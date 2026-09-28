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
    vi.mocked(scoreLeads).mockResolvedValue([])
    const res = await rescoreOrganizationLeads('org-1', { since, batchSize: 2 })
    expect(p.lead.findMany.mock.calls[0]![0]).toMatchObject({
      where: { organizationId: 'org-1', OR: [{ scoredAt: null }, { scoredAt: { lt: since } }] },
      orderBy: { scoredAt: { sort: 'asc', nulls: 'first' } },
      take: 2,
    })
    expect(scoreLeads).toHaveBeenCalledWith({ organizationId: 'org-1', leadIds: ['a', 'b'] })
    expect(res).toEqual({ rescored: 2, remaining: 0, since: since.toISOString() })
  })

  it('stops at the time budget and reports what is left', async () => {
    let t = 0
    vi.spyOn(Date, 'now').mockImplementation(() => (t += 30_000))
    p.lead.findMany.mockResolvedValue([{ id: 'a' }])
    p.lead.count.mockResolvedValue(7)
    vi.mocked(scoreLeads).mockResolvedValue([])
    const res = await rescoreOrganizationLeads('org-1', { batchSize: 1, budgetMs: 50_000 })
    expect(res.remaining).toBe(7)
    expect(res.rescored).toBeGreaterThanOrEqual(1)
    vi.restoreAllMocks()
  })
})
