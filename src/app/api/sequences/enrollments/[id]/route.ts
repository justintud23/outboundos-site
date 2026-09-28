import { NextResponse } from 'next/server'
import { updateEnrollment } from '@/features/sequences/server/update-enrollment'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getEnrollmentOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'
import { EnrollmentNotFoundError } from '@/features/sequences/types'

const VALID_ACTIONS = ['pause', 'resume', 'stop'] as const

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: enrollmentId } = await params

  const denied = denyUnlessCanAct(ctx, await getEnrollmentOwnerId(ctx.org.id, enrollmentId))
  if (denied) return denied

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
      organizationId: ctx.org.id,
      enrollmentId,
      action: body.action as 'pause' | 'resume' | 'stop',
      actorClerkId: ctx.member.clerkUserId,
    })
    return NextResponse.json(enrollment)
  } catch (err) {
    if (err instanceof EnrollmentNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
