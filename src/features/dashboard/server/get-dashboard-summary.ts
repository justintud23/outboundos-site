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
  // Only the leads and campaigns counts have a direct ownerId to filter on
  // (mirroring getLeads/getCampaigns). messagesSent/replies/positiveReplies
  // have no ownership rule defined for this task and are left org-wide.
  const [leads, campaigns, messagesSent, replies, positiveReplies] = await Promise.all([
    prisma.lead.count({ where: { organizationId, ...(ownerId && { ownerId }) } }),
    prisma.campaign.count({ where: { organizationId, ...(ownerId && { ownerId }) } }),
    prisma.outboundMessage.count({ where: { organizationId } }),
    prisma.inboundReply.count({ where: { organizationId } }),
    prisma.inboundReply.count({ where: { organizationId, classification: 'POSITIVE' } }),
  ])

  return { leads, campaigns, messagesSent, replies, positiveReplies }
}
