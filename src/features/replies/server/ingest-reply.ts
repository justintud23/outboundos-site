import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import type { InboundReplyDTO } from '../types'
import { LeadNotFoundByEmailError } from '../types'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { CLASSIFICATION_TO_STATUS } from '@/features/leads/types'

const FALLBACK_CLASSIFY_PROMPT = `You are an email reply classifier for a sales team.
Classify the reply into exactly one category:
- POSITIVE: Lead is interested, asking questions, or responding positively
- NEUTRAL: Unclear intent or polite acknowledgment without commitment
- NEGATIVE: Not interested or rejected the offer
- OUT_OF_OFFICE: Automated out-of-office or vacation response
- UNSUBSCRIBE_REQUEST: Requesting to be removed from the mailing list
- REFERRAL: Referring someone else who might be interested
- UNKNOWN: Cannot classify with confidence

Return ONLY a JSON object: { "classification": "<CATEGORY>", "confidence": <0.0-1.0> }
No markdown, no explanation.`

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

  // 3. Fetch active REPLY_CLASSIFICATION template (fallback to hardcoded prompt)
  const template = await prisma.promptTemplate.findFirst({
    where: { organizationId, promptType: 'REPLY_CLASSIFICATION', isActive: true },
  })
  const prompt = template?.body ?? FALLBACK_CLASSIFY_PROMPT

  // 4. AI classification — outside any transaction
  if (rawBody.length > 50_000) {
    throw new Error('Reply body exceeds maximum allowed length')
  }
  const { classification, confidence } = await getAIProvider().classifyReply({ rawBody }, prompt)

  // 5. Persist
  const reply = await prisma.inboundReply.create({
    data: {
      organizationId,
      leadId: lead.id,
      outboundMessageId,
      rawBody,
      classification,
      classificationConfidence: confidence,
      ...(receivedAt !== undefined && { receivedAt }),
    },
  })

  // 6. Auto-transition lead status based on classification
  const targetStatus = CLASSIFICATION_TO_STATUS[classification]
  if (targetStatus) {
    await transitionLeadStatus({
      organizationId,
      leadId: lead.id,
      newStatus: targetStatus,
      trigger: 'auto:reply_classification',
      metadata: { replyId: reply.id, classification, confidence },
    })
  }

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
