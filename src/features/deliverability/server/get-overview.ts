import { prisma } from '@/lib/db/prisma'
import { buildOverview } from '../overview'
import type { DeliverabilityOverview } from '../types'

const WINDOW_MS = 15 * 86_400_000 // 14 display days + slack for timezone edges

export async function getDeliverabilityOverview(organizationId: string, now = new Date()): Promise<DeliverabilityOverview> {
  const since = new Date(now.getTime() - WINDOW_MS)
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true, msTenantId: true } })
  const [mailboxes, domains, sends, bounces, replies, queuedNext24h] = await Promise.all([
    prisma.mailbox.findMany({
      where: { organizationId, ...(org.msTenantId ? { provider: 'MICROSOFT_GRAPH' as const } : {}) },
      orderBy: { email: 'asc' },
    }),
    prisma.domainHealth.findMany({ where: { organizationId }, orderBy: { domain: 'asc' } }),
    prisma.outboundMessage.findMany({ where: { organizationId, sentAt: { gte: since } }, select: { mailboxId: true, sentAt: true } }),
    prisma.messageEvent.findMany({
      where: { organizationId, eventType: 'BOUNCED', createdAt: { gte: since } },
      select: { createdAt: true, outboundMessage: { select: { mailboxId: true } } },
    }),
    prisma.inboundReply.findMany({
      where: { organizationId, receivedAt: { gte: since }, classification: { not: 'OUT_OF_OFFICE' }, mailboxId: { not: null } },
      select: { mailboxId: true, receivedAt: true },
    }),
    prisma.outboundMessage.count({ where: { organizationId, status: 'QUEUED', scheduledFor: { lte: new Date(now.getTime() + 86_400_000) } } }),
  ])
  return buildOverview({
    now, timezone: org.timezone, mailboxes, domains, queuedNext24h,
    sends: sends.filter((s) => s.sentAt).map((s) => ({ mailboxId: s.mailboxId, sentAt: s.sentAt! })),
    bounces: bounces.map((b) => ({ mailboxId: b.outboundMessage.mailboxId, at: b.createdAt })),
    replies: replies.map((r) => ({ mailboxId: r.mailboxId!, at: r.receivedAt })),
  })
}
