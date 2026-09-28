import { NextResponse } from 'next/server'
import { generateDraft } from '@/features/drafts/server/generate-draft'
import { PendingDraftExistsError, LeadNotFoundError } from '@/features/drafts/types'
import { DraftGenerationError } from '@/lib/ai'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getLeadOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'

export async function POST(request: Request) {
  const ctx = await resolveMember()

  if (!ctx) {
    return NextResponse.json(
      { error: 'No active organization. Select an organization to continue.' },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('leadId' in body) ||
    typeof (body as { leadId: unknown }).leadId !== 'string'
  ) {
    return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
  }

  const { leadId } = body as { leadId: string }

  const denied = denyUnlessCanAct(ctx, await getLeadOwnerId(ctx.org.id, leadId))
  if (denied) return denied

  try {
    const draft = await generateDraft({ organizationId: ctx.org.id, leadId, clerkUserId: ctx.member.clerkUserId })
    return NextResponse.json(draft, { status: 201 })
  } catch (err) {
    if (err instanceof PendingDraftExistsError) {
      return NextResponse.json(
        {
          code: 'PENDING_DRAFT_EXISTS',
          draftId: err.draftId,
          message: err.message,
        },
        { status: 409 },
      )
    }
    if (err instanceof LeadNotFoundError) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }
    if (err instanceof DraftGenerationError) {
      // AI generation failed — surface a clear, retryable signal. 502: upstream
      // (the model) failed; no draft was persisted.
      return NextResponse.json(
        { code: 'DRAFT_GENERATION_FAILED', error: err.message },
        { status: 502 },
      )
    }
    console.error('[POST /api/drafts/generate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
