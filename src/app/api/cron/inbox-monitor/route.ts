import { NextResponse } from 'next/server'
import { isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
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

  return NextResponse.json(result, { status })
}
