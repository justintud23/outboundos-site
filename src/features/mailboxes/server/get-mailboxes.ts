import { prisma } from '@/lib/db/prisma'
import { type MailboxDTO, toMailboxDTO } from '../types'

export async function getMailboxes(organizationId: string): Promise<MailboxDTO[]> {
  const rows = await prisma.mailbox.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
  })

  const now = new Date()
  return rows.map((m) => toMailboxDTO(m, now))
}
