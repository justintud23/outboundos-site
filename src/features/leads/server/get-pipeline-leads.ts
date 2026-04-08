import { prisma } from '@/lib/db/prisma'
import type { PipelineLeadDTO } from '../types'

interface GetPipelineLeadsInput {
  organizationId: string
}

export async function getPipelineLeads({
  organizationId,
}: GetPipelineLeadsInput): Promise<PipelineLeadDTO[]> {
  // 1. Fetch all leads for org
  const leads = await prisma.lead.findMany({
    where: { organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      company: true,
      status: true,
      score: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (leads.length === 0) return []

  const leadIds = leads.map((l) => l.id)

  // 2. Get latest outbound activity per lead
  const messageActivity = await prisma.outboundMessage.groupBy({
    by: ['leadId'],
    where: { organizationId, leadId: { in: leadIds } },
    _max: { sentAt: true },
  })

  // 3. Get latest inbound activity per lead
  const replyActivity = await prisma.inboundReply.groupBy({
    by: ['leadId'],
    where: { organizationId, leadId: { in: leadIds } },
    _max: { receivedAt: true },
  })

  // 4. Build lookup maps
  const latestMessage = new Map(
    messageActivity.map((m) => [m.leadId, m._max.sentAt]),
  )
  const latestReply = new Map(
    replyActivity.map((r) => [r.leadId, r._max.receivedAt]),
  )

  // 5. Compute lastActivityAt and build DTOs
  return leads.map((lead) => {
    const msgDate = latestMessage.get(lead.id)
    const replyDate = latestReply.get(lead.id)

    const candidates = [lead.updatedAt]
    if (msgDate) candidates.push(msgDate)
    if (replyDate) candidates.push(replyDate)

    const lastActivityAt = new Date(
      Math.max(...candidates.map((d) => d.getTime())),
    )

    return {
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      company: lead.company,
      status: lead.status,
      score: lead.score,
      lastActivityAt,
    }
  })
}
