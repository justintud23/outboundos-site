import { prisma } from '@/lib/db/prisma'

export interface DashboardSummaryDTO {
  leads: number
  campaigns: number
  messagesSent: number
  replies: number
  positiveReplies: number
}

export async function getDashboardSummary({
  organizationId,
}: {
  organizationId: string
}): Promise<DashboardSummaryDTO> {
  const [leads, campaigns, messagesSent, replies, positiveReplies] = await Promise.all([
    prisma.lead.count({ where: { organizationId } }),
    prisma.campaign.count({ where: { organizationId } }),
    prisma.outboundMessage.count({ where: { organizationId } }),
    prisma.inboundReply.count({ where: { organizationId } }),
    prisma.inboundReply.count({ where: { organizationId, classification: 'POSITIVE' } }),
  ])

  return { leads, campaigns, messagesSent, replies, positiveReplies }
}
