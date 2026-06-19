import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import {
  updateSubjectVariant,
  archiveSubjectVariant,
} from '@/features/sequences/server/manage-subject-variants'
import { SubjectVariantNotFoundError } from '@/features/sequences/types'

// PATCH — edit a variant's subject text.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { variantId } = await params
  const org = await resolveOrganization(orgId)

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
    const variant = await updateSubjectVariant({ organizationId: org.id, variantId, subject })
    return NextResponse.json(variant)
  } catch (err) {
    if (err instanceof SubjectVariantNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}

// DELETE — archive (soft-delete) a variant. Historical stats are preserved.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ variantId: string }> },
) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { variantId } = await params
  const org = await resolveOrganization(orgId)

  try {
    await archiveSubjectVariant({ organizationId: org.id, variantId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof SubjectVariantNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
