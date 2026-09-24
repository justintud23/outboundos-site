import type { Prisma } from '@prisma/client'
import { generateMessageId } from '../threading'

export interface QueueableDraft {
  id: string
  organizationId: string
  leadId: string
  campaignId: string | null
  subject: string
  body: string
  subjectVariantId: string | null
  subjectEdited: boolean
}

/**
 * Put an APPROVED draft on the send queue. Pacing and business hours are
 * enforced by the send queue at send time, so scheduledFor is "eligible from".
 * The unique draftId on OutboundMessage makes double-queueing impossible.
 */
export async function queueApprovedDraft(
  tx: Prisma.TransactionClient,
  draft: QueueableDraft,
  mailboxId: string,
  scheduledFor: Date = new Date(),
) {
  return tx.outboundMessage.create({
    data: {
      organizationId: draft.organizationId,
      leadId: draft.leadId,
      mailboxId,
      draftId: draft.id,
      ...(draft.campaignId && { campaignId: draft.campaignId }),
      ...(draft.subjectVariantId && !draft.subjectEdited && { subjectVariantId: draft.subjectVariantId }),
      subject: draft.subject,
      body: draft.body,
      status: 'QUEUED',
      messageId: generateMessageId(),
      scheduledFor,
    },
  })
}
