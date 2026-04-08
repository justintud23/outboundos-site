import { Prisma } from '@prisma/client'
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
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { TERMINAL_STATUSES } from '@/features/leads/types'
import { LeadInTerminalStateError } from '../types'

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
    include: { lead: { select: { id: true, email: true, status: true } } },
  })

  if (!draft) {
    throw new DraftNotFoundError()
  }

  // 2. Must be APPROVED
  if (draft.status !== 'APPROVED') {
    throw new DraftNotApprovedError(draft.status)
  }

  // 2b. Check lead is not in terminal state
  if (TERMINAL_STATUSES.includes(draft.lead.status)) {
    throw new LeadInTerminalStateError(draft.leadId, draft.lead.status)
  }

  // 3. Fetch active mailbox
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

  // 5. Send via provider — OUTSIDE transaction
  const { sgMessageId } = await getEmailProvider().sendEmail({
    to: draft.lead.email,
    fromEmail: mailbox.email,
    fromName: mailbox.displayName,
    subject: draft.subject,
    body: draft.body,
    customArgs: { draftId, leadId: draft.leadId },
  })

  // 6. Write OutboundMessage + update mailbox + AuditLog atomically
  const sentAt = new Date()

  let created: Awaited<ReturnType<typeof prisma.outboundMessage.create>>

  try {
    created = await prisma.$transaction(async (tx) => {
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
          sentAt,
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
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new DraftAlreadySentError()
    }
    throw err
  }

  // 6b. Auto-transition lead status: NEW → CONTACTED
  await transitionLeadStatus({
    organizationId,
    leadId: draft.leadId,
    newStatus: 'CONTACTED',
    trigger: 'auto:message_sent',
    metadata: { messageId: created.id, draftId },
  })

  // 7. Map to OutboundMessageDTO
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
