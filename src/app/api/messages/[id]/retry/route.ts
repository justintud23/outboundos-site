import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getMessageOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'
import { retryFailedMessage } from '@/features/messages/server/retry-message'
import { MessageNotFoundError, MessageNotFailedError } from '@/features/messages/types'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'No active organization. Select an organization to continue.' }, { status: 403 })
  }

  const { id } = await params

  const denied = denyUnlessCanAct(ctx, await getMessageOwnerId(ctx.org.id, id))
  if (denied) return denied

  try {
    const result = await retryFailedMessage({ organizationId: ctx.org.id, messageId: id })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof MessageNotFoundError) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 })
    }
    if (err instanceof MessageNotFailedError) {
      return NextResponse.json({ code: 'MESSAGE_NOT_FAILED', error: err.message }, { status: 409 })
    }
    console.error('[POST /api/messages/[id]/retry]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
