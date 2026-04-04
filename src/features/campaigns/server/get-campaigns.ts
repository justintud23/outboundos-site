import { prisma } from '@/lib/db/prisma'
import { CampaignStatus } from '@prisma/client'

export { CampaignStatus }

export interface CampaignSummaryDTO {
  id: string
  name: string
  description: string | null
  status: CampaignStatus
  createdAt: Date
  messageCount: number
  draftPendingCount: number
  draftApprovedCount: number
  replyCount: number
}

export async function getCampaigns({
  organizationId,
}: {
  organizationId: string
}): Promise<{ campaigns: CampaignSummaryDTO[]; total: number }> {
  const rows = await prisma.campaign.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: {
          outboundMessages: true,
          drafts: true,
        },
      },
    },
  })

  const ids = rows.map((r) => r.id)

  if (ids.length === 0) {
    return { campaigns: [], total: 0 }
  }

  // Draft status breakdown and reply counts — all in parallel.
  // groupBy doesn't support relation filters, so reply counts use
  // per-campaign count queries with a relation filter on outboundMessage.
  const [pendingCounts, approvedCounts, ...replyCounts] = await Promise.all([
    prisma.draft.groupBy({
      by: ['campaignId'],
      where: { organizationId, campaignId: { in: ids }, status: 'PENDING_REVIEW' },
      _count: { _all: true },
    }),
    prisma.draft.groupBy({
      by: ['campaignId'],
      where: { organizationId, campaignId: { in: ids }, status: 'APPROVED' },
      _count: { _all: true },
    }),
    ...ids.map((campaignId) =>
      prisma.inboundReply
        .count({ where: { organizationId, outboundMessage: { campaignId } } })
        .then((count) => ({ campaignId, count })),
    ),
  ])

  const pendingMap = new Map(pendingCounts.map((r) => [r.campaignId, r._count._all]))
  const approvedMap = new Map(approvedCounts.map((r) => [r.campaignId, r._count._all]))
  const replyMap = new Map(
    (replyCounts as { campaignId: string; count: number }[]).map((r) => [r.campaignId, r.count]),
  )

  const campaigns: CampaignSummaryDTO[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    messageCount: row._count.outboundMessages,
    draftPendingCount: pendingMap.get(row.id) ?? 0,
    draftApprovedCount: approvedMap.get(row.id) ?? 0,
    replyCount: replyMap.get(row.id) ?? 0,
  }))

  return { campaigns, total: campaigns.length }
}
