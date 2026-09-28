import { prisma } from '@/lib/db/prisma'

/**
 * Which mailboxes a send may use: the owner's own when they have any (even if
 * all are currently paused — then the send waits), otherwise shared ones.
 */
export async function mailboxOwnerFilter(organizationId: string, ownerId: string | null): Promise<{ ownerId: string | null }> {
  if (!ownerId) return { ownerId: null }
  const owned = await prisma.mailbox.count({ where: { organizationId, ownerId } })
  return owned > 0 ? { ownerId } : { ownerId: null }
}
