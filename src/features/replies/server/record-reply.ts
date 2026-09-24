import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { CLASSIFICATION_TO_STATUS } from '@/features/leads/types'

export const FALLBACK_CLASSIFY_PROMPT = `You are an email reply classifier for a sales team.
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

export interface RecordReplyInput {
  organizationId: string
  leadId: string
  outboundMessageId: string | null
  rawBody: string
  receivedAt?: Date
  mailboxId?: string
  graphMessageId?: string
  conversationId?: string | null
  fromEmail?: string
  subject?: string
}

/** Classify (AI, outside any tx), persist, and auto-transition the lead. */
export async function recordReply(input: RecordReplyInput) {
  const template = await prisma.promptTemplate.findFirst({
    where: { organizationId: input.organizationId, promptType: 'REPLY_CLASSIFICATION', isActive: true },
  })
  const prompt = template?.body ?? FALLBACK_CLASSIFY_PROMPT

  if (input.rawBody.length > 50_000) {
    throw new Error('Reply body exceeds maximum allowed length')
  }
  const { classification, confidence } = await getAIProvider().classifyReply({ rawBody: input.rawBody }, prompt)

  const reply = await prisma.inboundReply.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      outboundMessageId: input.outboundMessageId,
      rawBody: input.rawBody,
      classification,
      classificationConfidence: confidence,
      ...(input.receivedAt !== undefined && { receivedAt: input.receivedAt }),
      ...(input.mailboxId && { mailboxId: input.mailboxId }),
      ...(input.graphMessageId && { graphMessageId: input.graphMessageId }),
      ...(input.conversationId && { conversationId: input.conversationId }),
      ...(input.fromEmail && { fromEmail: input.fromEmail }),
      ...(input.subject && { subject: input.subject }),
    },
  })

  const targetStatus = CLASSIFICATION_TO_STATUS[classification]
  if (targetStatus) {
    await transitionLeadStatus({
      organizationId: input.organizationId,
      leadId: input.leadId,
      newStatus: targetStatus,
      trigger: 'auto:reply_classification',
      metadata: { replyId: reply.id, classification, confidence },
    })
  }
  return reply
}
