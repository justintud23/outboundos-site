import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

// Accepts either the root client or a transaction client so variant selection can
// run inside runSequenceStep's draft-creation transaction.
type Db = typeof prisma | Prisma.TransactionClient

export interface VariantSelection {
  variantId: string
  subject: string
}

/**
 * Pick the subject-line variant to assign to a FIRST-STEP draft, or null to fall
 * back to the step's own subject (i.e. no test).
 *
 * Rules:
 *  - A winner has been picked → always use the winner (the test concluded; losers
 *    are no longer assigned). Existing queued/sent rows are untouched elsewhere.
 *  - 0 or 1 active (non-archived) variants → null → no test → step.subject is used.
 *  - 2+ active variants → balanced round-robin: assign the active variant with the
 *    FEWEST drafts assigned so far, tie-broken by creation order. Deterministic and
 *    self-balancing across sends — the same fairness idea as mailbox LRU rotation.
 *    (Concurrent assignments may briefly read equal counts; the imbalance is at
 *    most the concurrency width and self-corrects on the next read.)
 */
export async function selectSubjectVariant(
  db: Db,
  sequenceStepId: string,
): Promise<VariantSelection | null> {
  const step = await db.sequenceStep.findUnique({
    where: { id: sequenceStepId },
    select: {
      winningVariantId: true,
      winningVariant: { select: { id: true, subject: true } },
      subjectVariants: {
        where: { isArchived: false },
        select: { id: true, subject: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!step) return null

  // A picked winner ends the test: always assign it, even as the sole arm.
  if (step.winningVariantId && step.winningVariant) {
    return { variantId: step.winningVariant.id, subject: step.winningVariant.subject }
  }

  const active = step.subjectVariants
  // Fewer than two arms is not a test — use the step's configured subject.
  if (active.length < 2) return null

  const ids = active.map((v) => v.id)
  const counts = await db.draft.groupBy({
    by: ['subjectVariantId'],
    where: { subjectVariantId: { in: ids } },
    _count: { _all: true },
  })
  const countById = new Map<string, number>(
    counts.map((c) => [c.subjectVariantId as string, c._count._all]),
  )

  // active is ordered oldest-first, so strict-less-than comparison makes the
  // oldest variant win ties — fully deterministic. active.length >= 2 here, so
  // active[0] is defined.
  let chosen = active[0]!
  let chosenCount = countById.get(chosen.id) ?? 0
  for (const v of active) {
    const n = countById.get(v.id) ?? 0
    if (n < chosenCount) {
      chosen = v
      chosenCount = n
    }
  }

  return { variantId: chosen.id, subject: chosen.subject }
}
