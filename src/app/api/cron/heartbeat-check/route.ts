import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getAuthPausedOrgIds, getStaleJobs, isAuthorizedCron } from '@/lib/cron'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { refreshAllDomains } from '@/features/deliverability/server/domain-health'

// A single domain check can take ~15s worst case; the domain refresh's own
// budget is capped below so it can't starve the stale-job tripwire.
export const maxDuration = 60

// Daily Vercel cron. The 5-minute jobs are driven by cron-job.org; if that
// silently stops, this is the tripwire.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Stale-job tripwire runs first, before the domain refresh, so a slow or
  // killed refresh can never prevent the "Scheduler has stopped" alert — the
  // only alert that fires when cron-job.org itself stops.
  // Orgs paused by a Microsoft 365 auth failure are reported too (their alert
  // email can't be delivered through the rejected credentials).
  const [stale, authPaused] = await Promise.all([getStaleJobs(), getAuthPausedOrgIds()])

  let alerted = 0
  if (stale.length > 0) {
    const orgs = await prisma.organization.findMany({ where: { escalationEmail: { not: null } }, select: { id: true } })
    for (const org of orgs) {
      const ok = await sendOrgAlert(
        org.id,
        'Scheduler has stopped',
        `These background jobs haven't run in over 30 minutes: ${stale.join(', ')}.\n\nEmails are not being sent and replies are not being detected. Check the jobs at cron-job.org (they must call the endpoints every 5 minutes with the Authorization header).`,
      )
      if (ok) alerted++
    }
  }

  // Daily domain health refresh (SPF/DKIM/MX/DMARC + registration date) runs
  // last, with a lowered budget so it leaves headroom under maxDuration.
  let domains: { checked: number; failed: number } | { error: string }
  try {
    domains = await refreshAllDomains(20_000)
  } catch (err) {
    console.error('[heartbeat-check] domain refresh failed', err)
    domains = { error: err instanceof Error ? err.message : String(err) }
  }

  return NextResponse.json({ stale, alerted, authPaused, domains })
}
