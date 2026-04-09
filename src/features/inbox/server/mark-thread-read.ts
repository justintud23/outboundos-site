import { prisma } from '@/lib/db/prisma'

interface MarkThreadReadInput {
  organizationId: string
  leadId: string
  isRead: boolean
}

export async function markThreadRead({
  organizationId,
  leadId,
  isRead,
}: MarkThreadReadInput): Promise<{ updated: number }> {
  const result = await prisma.inboundReply.updateMany({
    where: { organizationId, leadId },
    data: { isRead },
  })

  return { updated: result.count }
}
