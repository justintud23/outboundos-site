import { prisma } from '@/lib/db/prisma'
import type { FunnelStageDTO } from '../types'

interface GetFunnelDataInput {
  organizationId: string
  days?: number
}

export async function getFunnelData({
  organizationId,
  days,
}: GetFunnelDataInput): Promise<FunnelStageDTO[]> {
  const since = days ? (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - days)
    d.setUTCHours(0, 0, 0, 0)
    return d
  })() : undefined

  const dateFilter = since ? { gte: since } : undefined

  const [sent, deliveredRows, openedRows, replied, interested] = await Promise.all([
    prisma.outboundMessage.count({
      where: { organizationId, ...(dateFilter && { sentAt: dateFilter }) },
    }),
    prisma.messageEvent.groupBy({
      by: ['outboundMessageId'],
      where: { organizationId, eventType: 'DELIVERED', ...(dateFilter && { providerTimestamp: dateFilter }) },
    }),
    prisma.messageEvent.groupBy({
      by: ['outboundMessageId'],
      where: { organizationId, eventType: 'OPENED', ...(dateFilter && { providerTimestamp: dateFilter }) },
    }),
    prisma.inboundReply.count({
      where: { organizationId, ...(dateFilter && { receivedAt: dateFilter }) },
    }),
    prisma.lead.count({
      where: { organizationId, status: 'INTERESTED' },
    }),
  ])

  const delivered = deliveredRows.length
  const opened = openedRows.length
  const rate = (n: number) => sent === 0 ? 0 : Math.round((n / sent) * 1000) / 1000

  return [
    { stage: 'Sent', count: sent, rate: 1 },
    { stage: 'Delivered', count: delivered, rate: rate(delivered) },
    { stage: 'Opened', count: opened, rate: rate(opened) },
    { stage: 'Replied', count: replied, rate: rate(replied) },
    { stage: 'Interested', count: interested, rate: rate(interested) },
  ]
}
