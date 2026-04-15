import { prisma } from '@/lib/db/prisma'
import { LeadNotFoundError } from '../types'
import type { LeadDetailDTO } from '../types'

interface GetLeadInput {
  organizationId: string
  leadId: string
}

export async function getLead({
  organizationId,
  leadId,
}: GetLeadInput): Promise<LeadDetailDTO> {
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      title: true,
      linkedinUrl: true,
      phone: true,
      source: true,
      status: true,
      score: true,
      scoreReason: true,
      scoredAt: true,
      customFields: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!lead) {
    throw new LeadNotFoundError(leadId)
  }

  // Compute lastActivityAt from most recent outbound or inbound
  const [latestOutbound, latestInbound] = await Promise.all([
    prisma.outboundMessage.findFirst({
      where: { leadId, organizationId },
      select: { sentAt: true },
      orderBy: { sentAt: 'desc' },
    }),
    prisma.inboundReply.findFirst({
      where: { leadId, organizationId },
      select: { receivedAt: true },
      orderBy: { receivedAt: 'desc' },
    }),
  ])

  const dates = [lead.updatedAt]
  if (latestOutbound?.sentAt) dates.push(latestOutbound.sentAt)
  if (latestInbound?.receivedAt) dates.push(latestInbound.receivedAt)
  const lastActivityAt = new Date(Math.max(...dates.map((d) => d.getTime())))

  return { ...lead, lastActivityAt }
}
