import { prisma } from '@/lib/db/prisma'
import { scoreLeads } from '@/features/leads/server/score-leads'

/**
 * Rescores an org's leads in batches within a time budget. `since` marks the
 * start of this rescore run: leads scored at/after it are done and skipped, so
 * repeated calls (the UI loops while remaining > 0) never redo work.
 */
export async function rescoreOrganizationLeads(
  organizationId: string,
  opts: { since?: Date; batchSize?: number; budgetMs?: number } = {},
): Promise<{ rescored: number; remaining: number; since: string }> {
  const since = opts.since ?? new Date()
  const batchSize = opts.batchSize ?? 200
  const budgetMs = opts.budgetMs ?? 50_000
  const startedAt = Date.now()
  const pending = { organizationId, OR: [{ scoredAt: null }, { scoredAt: { lt: since } }] }
  let rescored = 0
  // A lead whose persist fails keeps its old `scoredAt`, so without this guard
  // the next batch's `findMany` could refetch and re-score it within the SAME
  // call, looping forever on a lead that will never persist.
  const processed = new Set<string>()

  while (Date.now() - startedAt < budgetMs) {
    const batch = await prisma.lead.findMany({
      where: { ...pending, id: { notIn: [...processed] } },
      orderBy: { scoredAt: { sort: 'asc', nulls: 'first' } },
      take: batchSize,
      select: { id: true },
    })
    if (batch.length === 0) break
    for (const lead of batch) processed.add(lead.id)
    await scoreLeads({ organizationId, leadIds: batch.map((l) => l.id) })
    rescored += batch.length
  }

  const remaining = await prisma.lead.count({ where: pending })
  return { rescored, remaining, since: since.toISOString() }
}
