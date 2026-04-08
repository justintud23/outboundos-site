import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { updateEnrollment } from '@/features/sequences/server/update-enrollment'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { EnrollmentNotFoundError } from '@/features/sequences/types'

const VALID_ACTIONS = ['pause', 'resume', 'stop'] as const

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: enrollmentId } = await params
  const org = await resolveOrganization(orgId)

  let body: { action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.action || !(VALID_ACTIONS as readonly string[]).includes(body.action)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const enrollment = await updateEnrollment({
      organizationId: org.id,
      enrollmentId,
      action: body.action as 'pause' | 'resume' | 'stop',
      actorClerkId: userId,
    })
    return NextResponse.json(enrollment)
  } catch (err) {
    if (err instanceof EnrollmentNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
