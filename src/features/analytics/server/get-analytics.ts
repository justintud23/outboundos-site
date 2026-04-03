import { prisma } from '@/lib/db/prisma'
import type { AnalyticsDTO } from '../types'

interface GetAnalyticsInput {
  organizationId: string
}

export async function getAnalytics({ organizationId }: GetAnalyticsInput): Promise<AnalyticsDTO> {
  const [
    sent,
    deliveredRows,
    openedRows,
    clickedRows,
    bouncedRows,
    unsubscribedRows,
    replies,
    positiveReplies,
  ] = await Promise.all([
    prisma.outboundMessage.count({ where: { organizationId } }),
    prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: 'DELIVERED' } }),
    prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: 'OPENED' } }),
    prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: 'CLICKED' } }),
    prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: 'BOUNCED' } }),
    prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: 'UNSUBSCRIBED' } }),
    prisma.inboundReply.count({ where: { organizationId } }),
    prisma.inboundReply.count({ where: { organizationId, classification: 'POSITIVE' } }),
  ])

  return {
    sent,
    delivered: deliveredRows.length,
    opened: openedRows.length,
    clicked: clickedRows.length,
    bounced: bouncedRows.length,
    unsubscribes: unsubscribedRows.length,
    replies,
    positiveReplies,
  }
}
