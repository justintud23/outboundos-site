import { prisma } from '@/lib/db/prisma'
import type { CampaignPerformanceDTO } from '../types'

interface GetCampaignPerformanceInput {
  organizationId: string
  days?: number
}

export async function getCampaignPerformance({
  organizationId,
  days,
}: GetCampaignPerformanceInput): Promise<CampaignPerformanceDTO[]> {
  const since = days ? (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - days)
    d.setUTCHours(0, 0, 0, 0)
    return d
  })() : undefined

  const dateFilter = since ? { gte: since } : undefined

  const campaigns = await prisma.campaign.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      status: true,
      _count: { select: { outboundMessages: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  if (campaigns.length === 0) return []

  const campaignIds = campaigns.map((c) => c.id)

  const [deliveredRows, openedRows, replyCounts, positiveCounts] = await Promise.all([
    prisma.messageEvent.groupBy({
      by: ['outboundMessageId'],
      where: {
        organizationId,
        eventType: 'DELIVERED',
        outboundMessage: { campaignId: { in: campaignIds } },
        ...(dateFilter && { providerTimestamp: dateFilter }),
      },
      _count: { _all: true },
    }).then(async (rows) => {
      if (rows.length === 0) return new Map<string, number>()
      const msgIds = rows.map((r) => r.outboundMessageId)
      const msgs = await prisma.outboundMessage.findMany({
        where: { id: { in: msgIds } },
        select: { id: true, campaignId: true },
      })
      const msgToCampaign = new Map<string, string | null>(msgs.map((m) => [m.id, m.campaignId]))
      const result = new Map<string, number>()
      for (const row of rows) {
        const cid = msgToCampaign.get(row.outboundMessageId)
        if (cid) result.set(cid, (result.get(cid) ?? 0) + 1)
      }
      return result
    }),
    prisma.messageEvent.groupBy({
      by: ['outboundMessageId'],
      where: {
        organizationId,
        eventType: 'OPENED',
        outboundMessage: { campaignId: { in: campaignIds } },
        ...(dateFilter && { providerTimestamp: dateFilter }),
      },
      _count: { _all: true },
    }).then(async (rows) => {
      if (rows.length === 0) return new Map<string, number>()
      const msgIds = rows.map((r) => r.outboundMessageId)
      const msgs = await prisma.outboundMessage.findMany({
        where: { id: { in: msgIds } },
        select: { id: true, campaignId: true },
      })
      const msgToCampaign = new Map<string, string | null>(msgs.map((m) => [m.id, m.campaignId]))
      const result = new Map<string, number>()
      for (const row of rows) {
        const cid = msgToCampaign.get(row.outboundMessageId)
        if (cid) result.set(cid, (result.get(cid) ?? 0) + 1)
      }
      return result
    }),
    Promise.all(campaignIds.map((campaignId) =>
      prisma.inboundReply.count({
        where: { organizationId, outboundMessage: { campaignId } },
      }).then((count) => ({ campaignId, count })),
    )),
    Promise.all(campaignIds.map((campaignId) =>
      prisma.inboundReply.count({
        where: { organizationId, outboundMessage: { campaignId }, classification: 'POSITIVE' },
      }).then((count) => ({ campaignId, count })),
    )),
  ])

  const replyMap = new Map(replyCounts.map((r) => [r.campaignId, r.count]))
  const positiveMap = new Map(positiveCounts.map((r) => [r.campaignId, r.count]))

  return campaigns
    .map((c) => {
      const sent = c._count.outboundMessages
      const delivered = deliveredRows.get(c.id) ?? 0
      const opened = openedRows.get(c.id) ?? 0
      const replied = replyMap.get(c.id) ?? 0
      const positive = positiveMap.get(c.id) ?? 0
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        sent,
        delivered,
        opened,
        replied,
        positiveReplies: positive,
        openRate: sent === 0 ? 0 : Math.round((opened / sent) * 1000) / 1000,
        replyRate: sent === 0 ? 0 : Math.round((replied / sent) * 1000) / 1000,
      }
    })
    .sort((a, b) => b.sent - a.sent)
}
