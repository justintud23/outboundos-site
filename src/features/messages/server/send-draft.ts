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

  // 3. Select a sending mailbox by rotating across the org's active mailboxes.
  //    Spreading sends across every connected inbox is the whole point of
  //    supporting multiple mailboxes: volume scaling and reputation spreading.
  const mailboxes = await prisma.mailbox.findMany({
    where: { organizationId, isActive: true },
  })

  if (mailboxes.length === 0) {
    throw new NoActiveMailboxError()
  }

  const today = new Date()

  // Lazy daily reset: a mailbox last reset on a prior day is treated as having
  // sent 0 today. (The counter and lastResetAt are actually written in the
  // transaction below, on the first send of the day.)
  const withUsage = mailboxes.map((m) => {
    const isNewDay = m.lastResetAt.toDateString() !== today.toDateString()
    return { mailbox: m, isNewDay, effectiveSentToday: isNewDay ? 0 : m.sentToday }
  })

  // Only mailboxes that still have daily headroom are eligible.
  const candidates = withUsage.filter(
    (c) => c.effectiveSentToday < c.mailbox.dailyLimit,
  )

  // Least-recently-used selection so volume spreads evenly instead of always
  // hitting whichever mailbox Postgres returns first. Deterministic ordering:
  //   1. lowest effective sentToday — the least-used mailbox today wins;
  //   2. oldest lastResetAt         — tie-break toward the one untouched longest;
  //   3. mailbox id (ascending)     — final tie-break for full determinism.
  candidates.sort((a, b) => {
    if (a.effectiveSentToday !== b.effectiveSentToday) {
      return a.effectiveSentToday - b.effectiveSentToday
    }
    const resetDiff = a.mailbox.lastResetAt.getTime() - b.mailbox.lastResetAt.getTime()
    if (resetDiff !== 0) return resetDiff
    return a.mailbox.id < b.mailbox.id ? -1 : a.mailbox.id > b.mailbox.id ? 1 : 0
  })

  const selected = candidates[0]
  if (!selected) {
    // Every active mailbox has already hit its daily limit.
    throw new MailboxLimitExceededError()
  }
  const { mailbox, isNewDay } = selected

  // RACE: mailbox selection here and the counter increment in the transaction
  // below are not atomic — concurrent sends can pick the same mailbox and both
  // pass the headroom check before either increments, briefly overshooting
  // dailyLimit. Fixing this is a separate upcoming task.

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
