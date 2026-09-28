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
  const batchSize = opts.batchSize ?? 50
  const budgetMs = opts.budgetMs ?? 40_000
  const startedAt = Date.now()
  const pending = { organizationId, OR: [{ scoredAt: null }, { scoredAt: { lt: since } }] }
  let rescored = 0
  // The slowest batch seen so far in this call, used to decide whether a NEW
  // batch would likely finish within the budget. Prevents starting a batch
  // that runs past a serverless function's maxDuration and gets killed
  // mid-flight (I2 / R-F) — better to return early and let the client's next
  // call pick up where this one left off.
  let slowestBatchMs = 0
  // A lead whose persist fails keeps its old `scoredAt`, so without this guard
  // the next batch's `findMany` could refetch and re-score it within the SAME
  // call, looping forever on a lead that will never persist.
  const processed = new Set<string>()

  for (;;) {
    const elapsed = Date.now() - startedAt
    if (elapsed + slowestBatchMs > budgetMs) break

    const batch = await prisma.lead.findMany({
      where: { ...pending, id: { notIn: [...processed] } },
      orderBy: { scoredAt: { sort: 'asc', nulls: 'first' } },
      take: batchSize,
      select: { id: true },
    })
    if (batch.length === 0) break
    for (const lead of batch) processed.add(lead.id)

    const batchStartedAt = Date.now()
    const results = await scoreLeads({ organizationId, leadIds: batch.map((l) => l.id) })
    const batchMs = Date.now() - batchStartedAt
    if (batchMs > slowestBatchMs) slowestBatchMs = batchMs

    // Only leads that actually persisted count toward `rescored` — a lead whose
    // save failed keeps its old `scoredAt` and is still pending (I3).
    rescored += results.filter((r) => r.success).length
  }

  const remaining = await prisma.lead.count({ where: pending })
  return { rescored, remaining, since: since.toISOString() }
}
