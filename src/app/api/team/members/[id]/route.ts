import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'
import { prisma } from '@/lib/db/prisma'
import { updateMember, TeamValidationError, type UpdateMemberPatch } from '@/features/team/server/team-settings'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  // "Self" means id === ctx.member.id: an admin may edit anyone, a member
  // only themselves. An unknown id falls through to the route's own 404
  // path (denyUnlessCanAct returns null for an undefined ownerId, whether
  // or not the caller is an admin) so existence is never leaked via a 403.
  const exists = await prisma.orgMember.findFirst({ where: { id, organizationId: ctx.org.id }, select: { id: true } })
  const denied = denyUnlessCanAct(ctx, exists ? id : undefined, 'You can only change your own settings.')
  if (denied) return denied
  if (!exists) {
    return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  }

  let body: { escalationEmail?: unknown; senderFirstName?: unknown; senderLastName?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const patch: UpdateMemberPatch = {}
  for (const key of ['escalationEmail', 'senderFirstName', 'senderLastName'] as const) {
    const value = body[key]
    if (value === undefined) continue
    if (value !== null && typeof value !== 'string') {
      return NextResponse.json({ error: `${key} must be a string or null` }, { status: 400 })
    }
    patch[key] = value
  }

  try {
    const found = await updateMember(ctx.org.id, id, patch)
    if (!found) {
      return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof TeamValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[PATCH /api/team/members/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
