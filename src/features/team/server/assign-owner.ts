import { prisma } from '@/lib/db/prisma'

export class InvalidOwnerError extends Error {
  constructor() {
    super('ownerId must be a member of this organization.')
    this.name = 'InvalidOwnerError'
    Object.setPrototypeOf(this, InvalidOwnerError.prototype)
  }
}

export type OwnableEntity = 'campaign' | 'lead' | 'mailbox'

export interface MemberSummary {
  id: string
  name: string | null
  email: string | null
  role: string
}

/**
 * Assigns (or clears, with `ownerId: null`) the owner of a campaign, lead, or
 * mailbox. `ownerId` is validated as a member of the org before the write.
 * Returns false when the entity isn't in this org (updateMany touches 0
 * rows) so routes can 404 without leaking existence.
 */
export async function assignOwner(
  organizationId: string,
  entity: OwnableEntity,
  id: string,
  ownerId: string | null,
): Promise<boolean> {
  if (ownerId !== null) {
    const member = await prisma.orgMember.findFirst({ where: { id: ownerId, organizationId } })
    if (!member) throw new InvalidOwnerError()
  }

  const where = { id, organizationId }
  const data = { ownerId }

  const result = await (entity === 'campaign'
    ? prisma.campaign.updateMany({ where, data })
    : entity === 'lead'
      ? prisma.lead.updateMany({ where, data })
      : prisma.mailbox.updateMany({ where, data }))

  return result.count > 0
}

/** All members of an org, for an owner picker. Ordered by name. */
export async function listMembers(organizationId: string): Promise<MemberSummary[]> {
  return prisma.orgMember.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  })
}
