import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { sendDraft } from '@/features/messages/server/send-draft'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import {
  DraftNotApprovedError,
  DraftAlreadySentError,
  NoActiveMailboxError,
  MailboxLimitExceededError,
} from '@/features/messages/types'
import { DraftNotFoundError } from '@/features/drafts/types'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await auth()

  if (!orgId || !userId) {
    return NextResponse.json(
      { error: 'No active organization. Select an organization to continue.' },
      { status: 403 },
    )
  }

  const { id: draftId } = await params
  const org = await resolveOrganization(orgId)

  try {
    const message = await sendDraft({ organizationId: org.id, draftId, clerkUserId: userId })
    return NextResponse.json(message, { status: 201 })
  } catch (err) {
    if (err instanceof DraftNotFoundError) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }
    if (err instanceof DraftNotApprovedError) {
      return NextResponse.json(
        { code: 'DRAFT_NOT_APPROVED', currentStatus: err.currentStatus, message: err.message },
        { status: 409 },
      )
    }
    if (err instanceof DraftAlreadySentError) {
      return NextResponse.json(
        { code: 'DRAFT_ALREADY_SENT', messageId: err.messageId, message: err.message },
        { status: 409 },
      )
    }
    if (err instanceof NoActiveMailboxError) {
      return NextResponse.json(
        { code: 'NO_ACTIVE_MAILBOX', message: err.message },
        { status: 422 },
      )
    }
    if (err instanceof MailboxLimitExceededError) {
      return NextResponse.json(
        { code: 'MAILBOX_LIMIT_EXCEEDED', message: err.message },
        { status: 429 },
      )
    }
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[POST /api/drafts/[id]/send]', err)
    return NextResponse.json(
      {
        error: process.env.NODE_ENV === 'development' ? message : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
