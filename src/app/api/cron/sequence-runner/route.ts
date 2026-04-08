import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { runSequenceStep } from '@/features/sequences/server/run-sequence-step'

const STALE_LOCK_MINUTES = 10
const BATCH_SIZE = 50

export async function POST(request: Request) {
  // Auth: verify CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // 1. Recover stale locks
  const staleThreshold = new Date(now.getTime() - STALE_LOCK_MINUTES * 60 * 1000)
  await prisma.sequenceEnrollment.updateMany({
    where: {
      processing: true,
      processingStartedAt: { lt: staleThreshold },
    },
    data: { processing: false, processingStartedAt: null },
  })

  // 2. Query due enrollments
  const dueEnrollments = await prisma.sequenceEnrollment.findMany({
    where: {
      status: 'ACTIVE',
      nextDueAt: { lte: now },
      processing: false,
    },
    orderBy: { nextDueAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true },
  })

  const results: { enrollmentId: string; result: string }[] = []

  // 3. Process each enrollment
  for (const { id } of dueEnrollments) {
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

  return NextResponse.json({
    processed: results.length,
    results,
    staleLockRecovery: true,
  })
}
