import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { pickSubjectVariantWinner } from '@/features/sequences/server/manage-subject-variants'
import {
  SubjectVariantStepNotFoundError,
  SubjectVariantNotFoundError,
} from '@/features/sequences/types'

// POST — manually pick (or clear) the winning variant for this step.
// { variantId: string } sets the winner; { variantId: null } resumes the split.
// This only changes which variant FUTURE sends use; queued/sent rows are untouched
// and NO statistical claim is made.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ stepId: string }> },
) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { stepId } = await params
  const org = await resolveOrganization(orgId)

  let body: { variantId?: string | null }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const variantId = body.variantId ?? null
  if (variantId !== null && typeof variantId !== 'string') {
    return NextResponse.json({ error: 'variantId must be a string or null' }, { status: 400 })
  }

  try {
    await pickSubjectVariantWinner({ organizationId: org.id, sequenceStepId: stepId, variantId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof SubjectVariantStepNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof SubjectVariantNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
}
