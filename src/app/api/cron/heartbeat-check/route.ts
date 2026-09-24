import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getStaleJobs, isAuthorizedCron } from '@/lib/cron'
import { sendOrgAlert } from '@/features/replies/server/notify'

// Daily Vercel cron. The 5-minute jobs are driven by cron-job.org; if that
// silently stops, this is the tripwire.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stale = await getStaleJobs()
  if (stale.length === 0) return NextResponse.json({ stale, alerted: 0 })

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
  return NextResponse.json({ stale, alerted })
}
