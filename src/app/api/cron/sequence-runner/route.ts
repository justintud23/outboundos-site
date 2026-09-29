import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { runSequenceStep } from '@/features/sequences/server/run-sequence-step'
import { isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
import { verifyPendingLeads, VERIFY_BUDGET_MS, type VerifyRunResult } from '@/features/verification/server/verify-leads'
import { prefetchSalesforceChecks } from '@/features/salesforce/server/check'

export const maxDuration = 60

const STALE_LOCK_MINUTES = 10
const BATCH_SIZE = 50
// cron-job.org's free tier times out at ~30s: stop starting new enrollments
// after this (each step may make an OpenAI call); the rest run next tick.
const SEQUENCE_RUNNER_BUDGET_MS = 25_000

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const now = new Date()
  const results: { enrollmentId: string; result: string }[] = []
  let outOfBudget = false
  let verification: VerifyRunResult | { error: string } | null = null

  try {
    // 1. Recover stale locks
    const staleThreshold = new Date(now.getTime() - STALE_LOCK_MINUTES * 60 * 1000)
    await prisma.sequenceEnrollment.updateMany({
      where: {
        processing: true,
        processingStartedAt: { lt: staleThreshold },
      },
      data: { processing: false, processingStartedAt: null },
    })

    // 1b. Verify pending lead emails first (up to 10 s of the 25 s budget) so a
    //     lead verified now can get its first email in this same tick. Never
    //     let a verification failure stop step processing.
    try {
      verification = await verifyPendingLeads(VERIFY_BUDGET_MS)
    } catch (err) {
      console.error('[sequence-runner] verification failed', err)
      verification = { error: err instanceof Error ? err.message : String(err) }
    }

    // 2. Query due enrollments
    const dueEnrollments = await prisma.sequenceEnrollment.findMany({
      where: {
        status: 'ACTIVE',
        nextDueAt: { lte: now },
        processing: false,
      },
      orderBy: { nextDueAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true, leadId: true },
    })

    // 2b. Warm the Salesforce pre-send cache for this batch ahead of time so
    //     each step's own check (in runSequenceStep) is more likely to hit a
    //     fresh cached result. Best-effort: never let a prefetch failure stop
    //     the tick from processing enrollments.
    try {
      await prefetchSalesforceChecks(dueEnrollments.map((e) => e.leadId))
    } catch (err) {
      console.error('[sequence-runner] salesforce prefetch failed', err)
    }

    // 3. Process each enrollment
    for (const { id } of dueEnrollments) {
      if (Date.now() - startedAt > SEQUENCE_RUNNER_BUDGET_MS) {
        outOfBudget = true
        break
      }

      // Atomic claim
      const claimed = await prisma.sequenceEnrollment.updateMany({
        where: { id, processing: false },
        data: { processing: true, processingStartedAt: now },
      })

      if (claimed.count === 0) {
        continue // Another instance claimed it
      }

      try {
        const result = await runSequenceStep({ enrollmentId: id })
        results.push({ enrollmentId: id, result })
      } catch (err) {
        console.error(`[sequence-runner] Error processing enrollment ${id}:`, err)
        results.push({ enrollmentId: id, result: 'ERROR' })
      } finally {
        // Always release lock
        await prisma.sequenceEnrollment.update({
          where: { id },
          data: { processing: false, processingStartedAt: null },
        })
      }
    }
  } finally {
    // Record the heartbeat even when the tick throws, so a broken runner shows
    // up as "ran" with its partial result instead of silently going stale.
    await recordHeartbeat('sequence-runner', { processed: results.length, outOfBudget })
  }

  return NextResponse.json({
    processed: results.length,
    results,
    staleLockRecovery: true,
    verification,
    ...(outOfBudget && { outOfBudget }),
  })
}
