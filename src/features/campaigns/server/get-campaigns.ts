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

  // For draft status breakdown we need separate counts — _count.select
  // doesn't support filtering, so we fetch them in parallel.
  const ids = rows.map((r) => r.id)

  const [pendingCounts, approvedCounts] = await Promise.all([
    ids.length === 0
      ? Promise.resolve([] as { campaignId: string; _count: { _all: number } }[])
      : prisma.draft.groupBy({
          by: ['campaignId'],
          where: { organizationId, campaignId: { in: ids }, status: 'PENDING_REVIEW' },
          _count: { _all: true },
        }),
    ids.length === 0
      ? Promise.resolve([] as { campaignId: string; _count: { _all: number } }[])
      : prisma.draft.groupBy({
          by: ['campaignId'],
          where: { organizationId, campaignId: { in: ids }, status: 'APPROVED' },
          _count: { _all: true },
        }),
  ])

  const pendingMap = new Map(pendingCounts.map((r) => [r.campaignId, r._count._all]))
  const approvedMap = new Map(approvedCounts.map((r) => [r.campaignId, r._count._all]))

  const campaigns: CampaignSummaryDTO[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status,
    createdAt: row.createdAt,
    messageCount: row._count.outboundMessages,
    draftPendingCount: pendingMap.get(row.id) ?? 0,
    draftApprovedCount: approvedMap.get(row.id) ?? 0,
  }))

  return { campaigns, total: campaigns.length }
}
