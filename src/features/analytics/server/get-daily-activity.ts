import { prisma } from '@/lib/db/prisma'
import type { DailyActivityPoint } from '../types'

interface GetDailyActivityInput {
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

export async function getDailyActivity({
  organizationId,
  days = 30,
}: GetDailyActivityInput): Promise<DailyActivityPoint[]> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  since.setUTCHours(0, 0, 0, 0)

  const [sentRows, repliedRows] = await Promise.all([
    prisma.outboundMessage.groupBy({
      by: ['sentAt'],
      where: {
        organizationId,
        sentAt: { gte: since },
      },
      _count: { _all: true },
    }),
    prisma.inboundReply.groupBy({
      by: ['receivedAt'],
      where: {
        organizationId,
        receivedAt: { gte: since },
      },
      _count: { _all: true },
    }),
  ])

  const sentMap = new Map<string, number>()
  for (const row of sentRows) {
    if (row.sentAt) {
      const key = formatDate(row.sentAt)
      sentMap.set(key, (sentMap.get(key) ?? 0) + row._count._all)
    }
  }

  const repliedMap = new Map<string, number>()
  for (const row of repliedRows) {
    const key = formatDate(row.receivedAt)
    repliedMap.set(key, (repliedMap.get(key) ?? 0) + row._count._all)
  }

  const dateRange = generateDateRange(days)
  return dateRange.map((date) => ({
    date,
    sent: sentMap.get(date) ?? 0,
    replied: repliedMap.get(date) ?? 0,
  }))
}
