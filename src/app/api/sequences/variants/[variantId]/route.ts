import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getVariantOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'
import {
  updateSubjectVariant,
  archiveSubjectVariant,
} from '@/features/sequences/server/manage-subject-variants'
import { SubjectVariantNotFoundError } from '@/features/sequences/types'
import { ContentHighRiskError } from '@/features/content-check/types'

// PATCH — edit a variant's subject text.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { variantId } = await params

  const denied = denyUnlessCanAct(ctx, await getVariantOwnerId(ctx.org.id, variantId))
  if (denied) return denied

  let body: { subject?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const subject = body.subject?.trim()
  if (!subject) {
    return NextResponse.json({ error: 'subject is required' }, { status: 400 })
  }

  try {
    const variant = await updateSubjectVariant({ organizationId: ctx.org.id, variantId, subject })
    return NextResponse.json(variant)
  } catch (err) {
    if (err instanceof SubjectVariantNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof ContentHighRiskError) {
      return NextResponse.json({ code: 'CONTENT_HIGH_RISK', error: err.message, findings: err.items }, { status: 422 })
    }
    throw err
  }
}

// DELETE — archive (soft-delete) a variant. Historical stats are preserved.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { variantId } = await params

  const denied = denyUnlessCanAct(ctx, await getVariantOwnerId(ctx.org.id, variantId))
  if (denied) return denied

  try {
    await archiveSubjectVariant({ organizationId: ctx.org.id, variantId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof SubjectVariantNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
