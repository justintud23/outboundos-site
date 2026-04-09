import { prisma } from '@/lib/db/prisma'
import type { DailyActivityExtendedPoint } from '../types'

interface GetDailyActivityExtendedInput {
  organizationId: string
  days?: number
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function generateDateRange(days: number): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    dates.push(formatDate(d))
  }
  return dates
}

export async function getDailyActivityExtended({
  organizationId,
  days = 30,
}: GetDailyActivityExtendedInput): Promise<DailyActivityExtendedPoint[]> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  since.setUTCHours(0, 0, 0, 0)

  const [sentRows, deliveredRows, openedRows, repliedRows] = await Promise.all([
    prisma.outboundMessage.groupBy({
      by: ['sentAt'],
      where: { organizationId, sentAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.messageEvent.groupBy({
      by: ['providerTimestamp'],
      where: { organizationId, eventType: 'DELIVERED', providerTimestamp: { gte: since } },
      _count: { _all: true },
    }),
    prisma.messageEvent.groupBy({
      by: ['providerTimestamp'],
      where: { organizationId, eventType: 'OPENED', providerTimestamp: { gte: since } },
      _count: { _all: true },
    }),
    prisma.inboundReply.groupBy({
      by: ['receivedAt'],
      where: { organizationId, receivedAt: { gte: since } },
      _count: { _all: true },
    }),
  ])

  function bucketByDate(rows: Array<{ _count: { _all: number }; [key: string]: unknown }>, dateField: string): Map<string, number> {
    const map = new Map<string, number>()
    for (const row of rows) {
      const val = row[dateField] as Date | null
      if (val) {
        const key = formatDate(val)
        map.set(key, (map.get(key) ?? 0) + row._count._all)
      }
    }
    return map
  }

  const sentMap = bucketByDate(sentRows, 'sentAt')
  const deliveredMap = bucketByDate(deliveredRows, 'providerTimestamp')
  const openedMap = bucketByDate(openedRows, 'providerTimestamp')
  const repliedMap = bucketByDate(repliedRows, 'receivedAt')

  const dateRange = generateDateRange(days)
  return dateRange.map((date) => ({
    date,
    sent: sentMap.get(date) ?? 0,
    delivered: deliveredMap.get(date) ?? 0,
    opened: openedMap.get(date) ?? 0,
    replied: repliedMap.get(date) ?? 0,
  }))
}
