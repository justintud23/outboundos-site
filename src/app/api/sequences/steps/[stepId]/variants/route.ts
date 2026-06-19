import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { createSubjectVariant } from '@/features/sequences/server/manage-subject-variants'
import { getSubjectVariantStats } from '@/features/sequences/server/get-subject-variant-stats'
import {
  SubjectVariantStepNotFoundError,
  SubjectVariantNotFirstStepError,
} from '@/features/sequences/types'

// GET — per-variant A/B test results for this step (derived stats).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ stepId: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { stepId } = await params
  const org = await resolveOrganization(orgId)
  const stats = await getSubjectVariantStats({ organizationId: org.id, sequenceStepId: stepId })
  if (!stats) return NextResponse.json({ error: 'Step not found' }, { status: 404 })
  return NextResponse.json(stats)
}

// POST — add a subject-line variant (A/B arm) to the first step.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ stepId: string }> },
) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { stepId } = await params
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
    const variant = await createSubjectVariant({ organizationId: org.id, sequenceStepId: stepId, subject })
    return NextResponse.json(variant, { status: 201 })
  } catch (err) {
    if (err instanceof SubjectVariantStepNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof SubjectVariantNotFirstStepError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
}
