import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getAuthPausedOrgIds, getStaleJobs, isAuthorizedCron } from '@/lib/cron'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { refreshAllDomains } from '@/features/deliverability/server/domain-health'

// A single domain check can take ~20s worst case, and the domain refresh
// below runs before the stale-job tripwire, so this must not be killed by
// the platform's short default timeout.
export const maxDuration = 60

// Daily Vercel cron. The 5-minute jobs are driven by cron-job.org; if that
// silently stops, this is the tripwire.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Daily domain health refresh (SPF/DKIM/MX/DMARC + registration date).
  let domains: { checked: number; failed: number } | { error: string }
  try {
    domains = await refreshAllDomains()
  } catch (err) {
    console.error('[heartbeat-check] domain refresh failed', err)
    domains = { error: err instanceof Error ? err.message : String(err) }
  }

  // Orgs paused by a Microsoft 365 auth failure are reported too (their alert
  // email can't be delivered through the rejected credentials).
  const [stale, authPaused] = await Promise.all([getStaleJobs(), getAuthPausedOrgIds()])
  if (stale.length === 0) return NextResponse.json({ stale, alerted: 0, authPaused, domains })

  const orgs = await prisma.organization.findMany({ where: { escalationEmail: { not: null } }, select: { id: true } })
  let alerted = 0
  for (const org of orgs) {
    const ok = await sendOrgAlert(
      org.id,
      'Scheduler has stopped',
      `These background jobs haven't run in over 30 minutes: ${stale.join(', ')}.\n\nEmails are not being sent and replies are not being detected. Check the jobs at cron-job.org (they must call the endpoints every 5 minutes with the Authorization header).`,
    )
    if (ok) alerted++
  }
  return NextResponse.json({ stale, alerted, authPaused, domains })
}
