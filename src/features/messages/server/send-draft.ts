import { prisma } from '@/lib/db/prisma'
import { getEmailProvider } from '@/lib/email'
import type { OutboundMessageDTO } from '../types'
import {
  DraftNotApprovedError,
  NoActiveMailboxError,
  MailboxLimitExceededError,
  DraftAlreadySentError,
} from '../types'
import { DraftNotFoundError } from '@/features/drafts/types'

interface SendDraftInput {
  organizationId: string
  draftId: string
  clerkUserId: string
}

export async function sendDraft({
  organizationId,
  draftId,
  clerkUserId,
}: SendDraftInput): Promise<OutboundMessageDTO> {
  // 1. Fetch draft (org-scoped)
  const draft = await prisma.draft.findFirst({
    where: { id: draftId, organizationId },
    include: { lead: { select: { email: true } } },
  })

  if (!draft) {
    throw new DraftNotFoundError()
  }

  // 2. Must be APPROVED
  if (draft.status !== 'APPROVED') {
    throw new DraftNotApprovedError(draft.status)
  }

  // 3. Check for existing OutboundMessage (idempotency guard)
  const existing = await prisma.outboundMessage.findFirst({
    where: { draftId, organizationId },
    select: { id: true },
  })

  if (existing) {
    throw new DraftAlreadySentError(existing.id)
  }

  // 4. Fetch active mailbox
  const mailbox = await prisma.mailbox.findFirst({
    where: { organizationId, isActive: true },
  })

  if (!mailbox) {
    throw new NoActiveMailboxError()
  }

  // 5. Lazy daily reset + limit check
  const today = new Date()
  const isNewDay = mailbox.lastResetAt.toDateString() !== today.toDateString()
  const effectiveSentToday = isNewDay ? 0 : mailbox.sentToday

  if (effectiveSentToday >= mailbox.dailyLimit) {
    throw new MailboxLimitExceededError()
  }

  // 6. Send email OUTSIDE the transaction
  const { sgMessageId } = await getEmailProvider().sendEmail({
    to: draft.lead.email,
    fromEmail: mailbox.email,
    fromName: mailbox.displayName,
    subject: draft.subject,
    body: draft.body,
    customArgs: { draftId, leadId: draft.leadId },
  })

  // 7. Transaction: create OutboundMessage, update mailbox, create audit log
  const created = await prisma.$transaction(async (tx) => {
    const message = await tx.outboundMessage.create({
      data: {
        organizationId,
        leadId: draft.leadId,
        mailboxId: mailbox.id,
        draftId,
        ...(draft.campaignId && { campaignId: draft.campaignId }),
        sgMessageId,
        subject: draft.subject,
        body: draft.body,
        status: 'SENT',
        sentAt: new Date(),
      },
    })

    await tx.mailbox.update({
      where: { id: mailbox.id },
      data: isNewDay
        ? { sentToday: 1, lastResetAt: today }
        : { sentToday: { increment: 1 } },
    })

    await tx.auditLog.create({
      data: {
        organizationId,
        actorClerkId: clerkUserId,
        action: 'message.sent',
        entityType: 'OutboundMessage',
        entityId: message.id,
        metadata: { draftId, leadId: draft.leadId, mailboxId: mailbox.id },
      },
    })

    return message
  })

  // 8. Map to OutboundMessageDTO
  return {
    id: created.id,
    organizationId: created.organizationId,
    leadId: created.leadId,
    mailboxId: created.mailboxId,
    campaignId: created.campaignId,
    draftId: created.draftId,
    sgMessageId: created.sgMessageId,
    subject: created.subject,
    body: created.body,
    status: created.status,
    sentAt: created.sentAt,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  }
}
