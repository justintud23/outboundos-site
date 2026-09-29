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
  ownerId,
}: {
  organizationId: string
  ownerId?: string
}): Promise<DashboardSummaryDTO> {
  // leads/campaigns have a direct ownerId to filter on (mirroring
  // getLeads/getCampaigns); messagesSent/replies/positiveReplies count
  // OutboundMessage/InboundReply rows, which reach their owner via the lead
  // relation (mirroring getReplies' `lead: { ownerId }`).
  const [leads, campaigns, messagesSent, replies, positiveReplies] = await Promise.all([
    prisma.lead.count({ where: { organizationId, ...(ownerId && { ownerId }) } }),
    prisma.campaign.count({ where: { organizationId, ...(ownerId && { ownerId }) } }),
    prisma.outboundMessage.count({ where: { organizationId, ...(ownerId && { lead: { ownerId } }) } }),
    prisma.inboundReply.count({ where: { organizationId, ...(ownerId && { lead: { ownerId } }) } }),
    prisma.inboundReply.count({
      where: { organizationId, classification: 'POSITIVE', ...(ownerId && { lead: { ownerId } }) },
    }),
  ])

  return { leads, campaigns, messagesSent, replies, positiveReplies }
}
