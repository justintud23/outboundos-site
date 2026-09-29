import { NextResponse } from 'next/server'
import { reviewDraft } from '@/features/drafts/server/review-draft'
import { DraftNotFoundError, DraftNotPendingError } from '@/features/drafts/types'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getDraftOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveMember()

  if (!ctx) {
    return NextResponse.json(
      { error: 'No active organization. Select an organization to continue.' },
      { status: 403 },
    )
  }

  const { id: draftId } = await params

  const denied = denyUnlessCanAct(ctx, await getDraftOwnerId(ctx.org.id, draftId))
  if (denied) return denied

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const {
    action,
    subject,
    body: emailBody,
    rejectionReason,
  } = body as {
    action?: unknown
    subject?: unknown
    body?: unknown
    rejectionReason?: unknown
  }

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { error: 'action must be "approve" or "reject"' },
      { status: 400 },
    )
  }

  try {
    const draft = await reviewDraft({
      organizationId: ctx.org.id,
      draftId,
      clerkUserId: ctx.member.clerkUserId,
      action,
      ...(typeof subject === 'string' && { subject }),
      ...(typeof emailBody === 'string' && { body: emailBody }),
      ...(typeof rejectionReason === 'string' && { rejectionReason }),
    })
    return NextResponse.json(draft)
  } catch (err) {
    if (err instanceof DraftNotFoundError) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }
    if (err instanceof DraftNotPendingError) {
      return NextResponse.json(
        {
          code: 'DRAFT_NOT_PENDING',
          currentStatus: err.currentStatus,
          message: err.message,
        },
        { status: 409 },
      )
    }
    console.error('[PATCH /api/drafts/[id]/review]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
