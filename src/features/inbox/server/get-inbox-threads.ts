import { prisma } from '@/lib/db/prisma'
import type { InboxThreadDTO, InboxFilter } from '../types'

interface GetInboxThreadsInput {
  organizationId: string
  filter?: InboxFilter
  limit?: number
  offset?: number
}

export async function getInboxThreads({
  organizationId,
  filter = 'all',
  limit = 25,
  offset = 0,
}: GetInboxThreadsInput): Promise<{ threads: InboxThreadDTO[]; total: number }> {
  const cappedLimit = Math.min(limit, 100)

  // Query 1: outbound activity per lead
  const outboundActivity = await prisma.outboundMessage.groupBy({
    by: ['leadId'],
    where: { organizationId },
    _max: { sentAt: true },
    _count: { _all: true },
  })

  // Query 2: inbound activity per lead
  const inboundActivity = await prisma.inboundReply.groupBy({
    by: ['leadId'],
    where: { organizationId },
    _max: { receivedAt: true },
    _count: { _all: true },
  })

  // Merge: collect all leadIds with activity
  const outboundMap = new Map(
    outboundActivity.map((o) => [o.leadId, { latestOutbound: o._max.sentAt, messageCount: o._count._all }]),
  )
  const inboundMap = new Map(
    inboundActivity.map((i) => [i.leadId, { latestInbound: i._max.receivedAt, replyCount: i._count._all }]),
  )

  const allLeadIds = new Set([...outboundMap.keys(), ...inboundMap.keys()])

  if (allLeadIds.size === 0) {
    return { threads: [], total: 0 }
  }

  // Compute lastActivityAt per lead and sort
  type LeadActivity = { leadId: string; lastActivityAt: Date; messageCount: number; replyCount: number }
  const activities: LeadActivity[] = []

  for (const leadId of allLeadIds) {
    const ob = outboundMap.get(leadId)
    const ib = inboundMap.get(leadId)

    const candidates: Date[] = []
    if (ob?.latestOutbound) candidates.push(ob.latestOutbound)
    if (ib?.latestInbound) candidates.push(ib.latestInbound)

    const lastActivityAt = candidates.length > 0
      ? new Date(Math.max(...candidates.map((d) => d.getTime())))
      : new Date(0)

    activities.push({
      leadId,
      lastActivityAt,
      messageCount: ob?.messageCount ?? 0,
      replyCount: ib?.replyCount ?? 0,
    })
  }

  // Sort by lastActivityAt DESC
  activities.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())

  // Fetch leads for filtering + data
  const leadIds = activities.map((a) => a.leadId)

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, organizationId },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      company: true, status: true,
    },
  })

  const leadMap = new Map(leads.map((l) => [l.id, l]))

  // Apply filter
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  let filtered = activities.filter((a) => leadMap.has(a.leadId))

  if (filter === 'interested') {
    filtered = filtered.filter((a) => leadMap.get(a.leadId)!.status === 'INTERESTED')
  } else if (filter === 'unsubscribed') {
    filtered = filtered.filter((a) => leadMap.get(a.leadId)!.status === 'UNSUBSCRIBED')
  } else if (filter === 'recent') {
    filtered = filtered.filter((a) => a.lastActivityAt >= sevenDaysAgo)
  }

  // Get unread counts
  const paginatedLeadIds = filtered.map((a) => a.leadId)

  const unreadCounts = paginatedLeadIds.length > 0
    ? await prisma.inboundReply.groupBy({
        by: ['leadId'],
        where: { organizationId, leadId: { in: paginatedLeadIds }, isRead: false },
        _count: { _all: true },
      })
    : []
  const unreadMap = new Map(unreadCounts.map((u) => [u.leadId, u._count._all]))

  // Apply unread filter if needed
  if (filter === 'unread') {
    filtered = filtered.filter((a) => (unreadMap.get(a.leadId) ?? 0) > 0)
  }

  const finalTotal = filtered.length

  // Apply pagination
  const page = filtered.slice(offset, offset + cappedLimit)
  const pageLeadIds = page.map((a) => a.leadId)

  // Get latest reply for preview + classification
  const latestReplies = pageLeadIds.length > 0
    ? await prisma.inboundReply.findMany({
        where: { organizationId, leadId: { in: pageLeadIds } },
        orderBy: { receivedAt: 'desc' },
        distinct: ['leadId'],
        select: { leadId: true, rawBody: true, classification: true },
      })
    : []

  const latestReplyMap = new Map(latestReplies.map((r) => [r.leadId, r]))

  // Build DTOs
  const threads: InboxThreadDTO[] = page.map((activity) => {
    const lead = leadMap.get(activity.leadId)!
    const latestReply = latestReplyMap.get(activity.leadId)
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email

    return {
      leadId: activity.leadId,
      leadName: name,
      leadEmail: lead.email,
      leadCompany: lead.company,
      leadStatus: lead.status,
      lastActivityAt: activity.lastActivityAt,
      unreadCount: unreadMap.get(activity.leadId) ?? 0,
      messageCount: activity.messageCount,
      replyCount: activity.replyCount,
      latestClassification: latestReply?.classification ?? null,
      latestPreview: latestReply?.rawBody?.slice(0, 120) ?? '',
    }
  })

  return { threads, total: finalTotal }
}
