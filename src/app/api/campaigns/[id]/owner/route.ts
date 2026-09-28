import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { assignOwner, InvalidOwnerError } from '@/features/team/server/assign-owner'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  const { id } = await params

  let body: { ownerId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (body.ownerId !== null && typeof body.ownerId !== 'string') {
    return NextResponse.json({ error: 'ownerId must be a string or null' }, { status: 400 })
  }

  try {
    const found = await assignOwner(ctx.org.id, 'campaign', id, body.ownerId)
    if (!found) {
      return NextResponse.json({ error: 'Campaign not found.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, ownerId: body.ownerId })
  } catch (err) {
    if (err instanceof InvalidOwnerError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }
}
