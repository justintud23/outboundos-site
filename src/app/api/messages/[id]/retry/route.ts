import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { retryFailedMessage } from '@/features/messages/server/retry-message'
import { MessageNotFoundError, MessageNotFailedError } from '@/features/messages/types'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'No active organization. Select an organization to continue.' }, { status: 403 })
  }

  const { id } = await params
  try {
    const org = await resolveOrganization(orgId)
    const result = await retryFailedMessage({ organizationId: org.id, messageId: id })
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
