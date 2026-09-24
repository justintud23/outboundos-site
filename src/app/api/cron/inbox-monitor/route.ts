import { NextResponse } from 'next/server'
import { getAuthPausedOrgIds, isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
import { monitorMailboxes, type MonitorResult } from '@/features/inbox/server/monitor-mailboxes'

export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let result: MonitorResult | { error: string } = { error: 'inbox-monitor tick did not complete' }
  let status = 200
  try {
    result = await monitorMailboxes()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[inbox-monitor] tick failed:', err)
    result = { error: message }
    status = 500
  } finally {
    // Record the heartbeat even on failure, so a broken tick shows up as
    // "ran but errored" rather than silently going stale.
    await recordHeartbeat('inbox-monitor', result)
  }

  // Failing mailboxes or a Microsoft 365 auth pause fail the request, so
  // cron-job.org's "notify on failure" reaches the operator even when email
  // through Microsoft 365 is what's broken.
  if (status === 200) {
    const authPaused = await getAuthPausedOrgIds()
    const mailboxErrors = 'errors' in result ? result.errors : 0
    if (authPaused.length > 0 || mailboxErrors > 0) {
      return NextResponse.json({ ...result, authPaused }, { status: 503 })
    }
  }

  return NextResponse.json(result, { status })
}
