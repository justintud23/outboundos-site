import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getStepOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'
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
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { stepId } = await params

  const denied = denyUnlessCanAct(ctx, await getStepOwnerId(ctx.org.id, stepId))
  if (denied) return denied

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
    await pickSubjectVariantWinner({ organizationId: ctx.org.id, sequenceStepId: stepId, variantId })
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
