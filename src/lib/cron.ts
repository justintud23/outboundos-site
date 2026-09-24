import crypto from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

export type CronJob = 'sequence-runner' | 'send-queue' | 'inbox-monitor'
export const CRON_JOBS: CronJob[] = ['sequence-runner', 'send-queue', 'inbox-monitor']
export const STALE_AFTER_MS = 30 * 60 * 1000

// Every automatic pause caused by Microsoft 365 rejecting our credentials
// (send queue or inbox monitor) has a pausedReason starting with this.
export const MS_AUTH_PAUSE_PREFIX = 'Microsoft 365'

/**
 * Orgs whose sending is paused because Microsoft 365 rejected our access
 * (expired secret, revoked consent, …). The alert email for that pause goes
 * out through the same rejected credentials, so the cron endpoints report it
 * as an HTTP failure too — cron-job.org's failure notification then reaches
 * the operator independently of Microsoft 365.
 */
export async function getAuthPausedOrgIds(): Promise<string[]> {
  const rows = await prisma.organization.findMany({
    where: { msTenantId: { not: null }, sendingPaused: true, pausedReason: { startsWith: MS_AUTH_PAUSE_PREFIX } },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization')
  if (!header) return false

  // Constant-time comparison so response timing can't leak the secret.
  // timingSafeEqual throws on a length mismatch, so check lengths first
  // (that length check itself isn't secret-dependent enough to matter).
  const expected = Buffer.from(`Bearer ${secret}`)
  const actual = Buffer.from(header)
  if (actual.length !== expected.length) return false
  return crypto.timingSafeEqual(actual, expected)
}

export async function recordHeartbeat(job: CronJob, result: unknown): Promise<void> {
  const lastResult = JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue
  const lastRunAt = new Date()
  await prisma.cronHeartbeat.upsert({
    where: { job },
    create: { job, lastRunAt, lastResult },
    update: { lastRunAt, lastResult },
  })
}

/** Jobs that have never run or haven't run in STALE_AFTER_MS. */
export async function getStaleJobs(now: Date = new Date()): Promise<CronJob[]> {
  const rows = await prisma.cronHeartbeat.findMany({ where: { job: { in: CRON_JOBS } } })
  const last = new Map(rows.map((r) => [r.job, r.lastRunAt]))
  return CRON_JOBS.filter((job) => {
    const at = last.get(job)
    return !at || now.getTime() - at.getTime() > STALE_AFTER_MS
  })
}
