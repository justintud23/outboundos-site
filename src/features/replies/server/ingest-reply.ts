import { prisma } from '@/lib/db/prisma'
import type { InboundReplyDTO } from '../types'
import { LeadNotFoundByEmailError } from '../types'
import { recordReply } from './record-reply'

export interface IngestReplyInput {
  organizationId: string
  fromEmail: string
  rawBody: string
  inReplyToSgMessageId?: string
  receivedAt?: Date
}

export async function ingestReply({
  organizationId,
  fromEmail,
  rawBody,
  inReplyToSgMessageId,
  receivedAt,
}: IngestReplyInput): Promise<InboundReplyDTO> {
  // 1. Find lead by email (org-scoped compound unique)
  const lead = await prisma.lead.findUnique({
    where: { organizationId_email: { organizationId, email: fromEmail } },
    select: { id: true },
  })

  if (!lead) {
    throw new LeadNotFoundByEmailError(fromEmail)
  }

  // 2. Optionally link to outbound message
  let outboundMessageId: string | null = null
  if (inReplyToSgMessageId) {
    const message = await prisma.outboundMessage.findFirst({
      where: { sgMessageId: inReplyToSgMessageId, organizationId },
      select: { id: true },
    })
    outboundMessageId = message?.id ?? null
  }

  // 3-6. Classify, persist, and auto-transition the lead.
  const reply = await recordReply({ organizationId, leadId: lead.id, outboundMessageId, rawBody, receivedAt })

  return {
    id: reply.id,
    organizationId: reply.organizationId,
    leadId: reply.leadId,
    outboundMessageId: reply.outboundMessageId,
    rawBody: reply.rawBody,
    classification: reply.classification,
    classificationConfidence: reply.classificationConfidence,
    receivedAt: reply.receivedAt,
    createdAt: reply.createdAt,
  }
}
