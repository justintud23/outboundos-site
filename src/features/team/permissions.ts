export interface PermissionContext { isAdmin: boolean; member: { id: string } }

export class NotOwnerError extends Error {
  constructor() {
    super('You can only change your own campaigns and leads.')
    this.name = 'NotOwnerError'
    Object.setPrototypeOf(this, NotOwnerError.prototype)
  }
}

export class AdminOnlyError extends Error {
  constructor() {
    super('Only an admin can do this.')
    this.name = 'AdminOnlyError'
    Object.setPrototypeOf(this, AdminOnlyError.prototype)
  }
}

/** Admins act on everything; members only on what they own (unassigned = admin-only). */
export function canAct(ctx: PermissionContext, ownerId: string | null): boolean {
  if (ctx.isAdmin) return true
  return ownerId !== null && ownerId === ctx.member.id
}

export function assertCanAct(ctx: PermissionContext, ownerId: string | null): void {
  if (!canAct(ctx, ownerId)) throw new NotOwnerError()
}

export function assertAdmin(ctx: PermissionContext): void {
  if (!ctx.isAdmin) throw new AdminOnlyError()
}
