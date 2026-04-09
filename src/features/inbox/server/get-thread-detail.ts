import { prisma } from '@/lib/db/prisma'
import type { ThreadDetailDTO, ThreadMessageDTO } from '../types'

interface GetThreadDetailInput {
  organizationId: string
  leadId: string
}

export async function getThreadDetail({
  organizationId,
  leadId,
}: GetThreadDetailInput): Promise<ThreadDetailDTO> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      company: true, title: true, status: true, score: true,
    },
  })

  if (!lead) {
    throw new Error('Lead not found')
  }

  const outboundMessages = await prisma.outboundMessage.findMany({
    where: { leadId, organizationId },
    select: { id: true, subject: true, body: true, sentAt: true, status: true },
    orderBy: { sentAt: 'asc' },
  })

  const inboundReplies = await prisma.inboundReply.findMany({
    where: { leadId, organizationId },
    select: {
      id: true, rawBody: true, receivedAt: true,
      classification: true, classificationConfidence: true, isRead: true,
    },
    orderBy: { receivedAt: 'asc' },
  })

  const messages: ThreadMessageDTO[] = [
    ...outboundMessages.map((m) => ({
      id: m.id,
      direction: 'outbound' as const,
      subject: m.subject,
      body: m.body,
      timestamp: m.sentAt ?? new Date(0),
      status: m.status,
    })),
    ...inboundReplies.map((r) => ({
      id: r.id,
      direction: 'inbound' as const,
      subject: null,
      body: r.rawBody,
      timestamp: r.receivedAt,
      classification: r.classification,
      classificationConfidence: r.classificationConfidence ?? undefined,
      isRead: r.isRead,
    })),
  ]

  messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return { lead, messages, totalMessages: messages.length }
}
