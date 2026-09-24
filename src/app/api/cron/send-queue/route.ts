import { NextResponse } from 'next/server'
import { isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
import { processSendQueue } from '@/features/messages/server/process-send-queue'

export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await processSendQueue()
  await recordHeartbeat('send-queue', result)
  return NextResponse.json(result)
}
