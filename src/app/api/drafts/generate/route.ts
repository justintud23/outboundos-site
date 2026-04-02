import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { generateDraft } from '@/features/drafts/server/generate-draft'
import { PendingDraftExistsError, LeadNotFoundError } from '@/features/drafts/types'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export async function POST(request: Request) {
  const { orgId, userId } = await auth()

  if (!orgId || !userId) {
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

  const org = await resolveOrganization(orgId)

  try {
    const draft = await generateDraft({ organizationId: org.id, leadId, clerkUserId: userId })
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
    console.error('[POST /api/drafts/generate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
