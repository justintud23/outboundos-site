import { NextResponse } from 'next/server'
import { getAuthPausedOrgIds, isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
import { processSendQueue, type SendQueueResult } from '@/features/messages/server/process-send-queue'

export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let result: SendQueueResult | { error: string } = { error: 'send-queue tick did not complete' }
  let status = 200
  try {
    result = await processSendQueue()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[send-queue] tick failed:', err)
    result = { error: message }
    status = 500
  } finally {
    // Record the heartbeat even on failure, so a broken tick shows up as
    // "ran but errored" rather than silently going stale.
    await recordHeartbeat('send-queue', result)
  }

  // A Microsoft 365 auth pause can't alert by email (the alert would use the
  // rejected credentials), so fail the request: cron-job.org's "notify on
  // failure" emails the operator independently of Microsoft 365.
  if (status === 200) {
    const authPaused = await getAuthPausedOrgIds()
    if (authPaused.length > 0) return NextResponse.json({ ...result, authPaused }, { status: 503 })
  }

  return NextResponse.json(result, { status })
}
