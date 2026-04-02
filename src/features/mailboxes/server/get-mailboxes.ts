import { prisma } from '@/lib/db/prisma'
import type { MailboxDTO } from '../types'

export async function getMailboxes(organizationId: string): Promise<MailboxDTO[]> {
  const rows = await prisma.mailbox.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
  })

  return rows.map((m) => ({
    id: m.id,
    organizationId: m.organizationId,
    email: m.email,
    displayName: m.displayName,
    isActive: m.isActive,
    dailyLimit: m.dailyLimit,
    sentToday: m.sentToday,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }))
}
