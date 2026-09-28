import { NextResponse } from 'next/server'
import { NotOwnerError, AdminOnlyError, canAct, type PermissionContext } from '@/features/team/permissions'

export function permissionErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof NotOwnerError) return NextResponse.json({ code: 'NOT_OWNER', error: err.message }, { status: 403 })
  if (err instanceof AdminOnlyError) return NextResponse.json({ code: 'ADMIN_ONLY', error: err.message }, { status: 403 })
  return null
}

/**
 * Route guard for owner-scoped writes. `ownerId` comes from an owner lookup
 * (see features/team/server/owners.ts): `undefined` means the entity wasn't
 * found in this org, so we return null and let the route's own 404 path
 * handle it rather than leaking existence via a 403.
 */
export function denyUnlessCanAct(ctx: PermissionContext, ownerId: string | null | undefined): NextResponse | null {
  if (ownerId === undefined) return null
  if (canAct(ctx, ownerId)) return null
  return NextResponse.json({ code: 'NOT_OWNER', error: 'You can only change your own campaigns and leads.' }, { status: 403 })
}

/** Route guard for admin-only actions (settings, mailboxes, deliverability). */
export function denyUnlessAdmin(ctx: PermissionContext): NextResponse | null {
  if (ctx.isAdmin) return null
  return NextResponse.json({ code: 'ADMIN_ONLY', error: 'Only an admin can do this.' }, { status: 403 })
}
