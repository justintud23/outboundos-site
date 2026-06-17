import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getEmailProvider } from '@/lib/email'
import { signUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import type { OutboundMessageDTO } from '../types'
import {
  DraftNotApprovedError,
  NoActiveMailboxError,
  MailboxLimitExceededError,
  DraftAlreadySentError,
  DraftSendInProgressError,
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

  // Per-recipient one-click unsubscribe URL (RFC 8058). The token is an opaque,
  // signed blob — no raw leadId in the query string — that the future
  // /api/unsubscribe endpoint will decrypt back to { leadId, organizationId }.
  const unsubscribeToken = signUnsubscribeToken({ leadId: draft.leadId, organizationId })
  const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/unsubscribe?token=${unsubscribeToken}`

  // 4. CLAIM the draft BEFORE the network send. Creating the OutboundMessage in
  //    QUEUED state first means the unique draftId constraint reserves this
  //    draft atomically: two concurrent/retried sends race here, exactly one
  //    wins the insert, and the loser never reaches the provider call. This is
  //    what makes a double-send impossible — idempotency no longer depends on a
  //    post-send insert that runs only AFTER the email has already gone out.
  let claim: Awaited<ReturnType<typeof prisma.outboundMessage.create>>
  try {
    claim = await prisma.outboundMessage.create({
      data: {
        organizationId,
        leadId: draft.leadId,
        mailboxId: mailbox.id,
        draftId,
        ...(draft.campaignId && { campaignId: draft.campaignId }),
        subject: draft.subject,
        body: draft.body,
        status: 'QUEUED',
      },
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // The draft is already claimed. Resolve WITHOUT re-sending — the cardinal
      // rule is "if a claim row exists, never call the provider again".
      return await resolveExistingClaim({ organizationId, draftId, leadId: draft.leadId })
    }
    throw err
  }

  // 5. Send via provider. We own the claim, so this runs at most once per draft.
  let sgMessageId: string | null
  try {
    ;({ sgMessageId } = await getEmailProvider().sendEmail({
      to: draft.lead.email,
      fromEmail: mailbox.email,
      fromName: mailbox.displayName,
      subject: draft.subject,
      body: draft.body,
      customArgs: { draftId, leadId: draft.leadId },
      listUnsubscribe: { url: unsubscribeUrl },
    }))
  } catch (sendErr) {
    // DEFINITE failure: the provider threw, so no email was delivered. Release
    // the claim by deleting the QUEUED row so a deliberate retry can re-claim
    // and send cleanly — a failed send must not wedge the draft as "sent".
    // (Delete, not mark-FAILED: a FAILED row would still occupy the unique
    // draftId and force the retry to special-case it; deleting returns the
    // draft to a pristine, never-attempted state. The provider error is
    // surfaced to the caller.)
    await prisma.outboundMessage.delete({ where: { id: claim.id } }).catch((delErr) => {
      console.error(`[sendDraft] Failed to release claim ${claim.id} after send error:`, delErr)
    })
    throw sendErr
  }

  // 6. FINALIZE: flip the claim QUEUED -> SENT and fill sgMessageId, increment
  //    the mailbox counter, and write the AuditLog — atomically.
  const sentAt = new Date()
  const finalized = await prisma.$transaction(async (tx) => {
    const message = await tx.outboundMessage.update({
      where: { id: claim.id },
      data: { status: 'SENT', sgMessageId, sentAt },
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

  // 6b. Auto-transition lead status: NEW → CONTACTED
  await transitionLeadStatus({
    organizationId,
    leadId: draft.leadId,
    newStatus: 'CONTACTED',
    trigger: 'auto:message_sent',
    metadata: { messageId: finalized.id, draftId },
  })

  return toDTO(finalized)
}

// How long a QUEUED claim is treated as an in-flight send. A claim older than
// this is considered abandoned (the sending process crashed, or its finalize
// UPDATE never landed) and is reconciled rather than treated as concurrent.
// Comfortably longer than a provider call + finalize, well under any human retry.
const CLAIM_STALE_MS = 2 * 60 * 1000

/**
 * A claim row already exists for this draft (the claiming insert hit the unique
 * draftId constraint). Resolve it WITHOUT ever re-sending:
 *  - SENT                  → the send already completed → DraftAlreadySentError.
 *  - QUEUED, claim fresh    → another invocation is mid-send → DraftSendInProgressError.
 *  - QUEUED, claim stale    → the prior attempt's process died (or its finalize
 *                             UPDATE failed) after the provider call. We cannot
 *                             know whether the email went out, so we reconcile
 *                             the row to SENT instead of risking a duplicate
 *                             send. (Residual window: a claim that died BEFORE
 *                             the provider call is also reconciled to SENT and
 *                             will silently never send — see module summary.)
 */
async function resolveExistingClaim({
  organizationId,
  draftId,
  leadId,
}: {
  organizationId: string
  draftId: string
  leadId: string
}): Promise<OutboundMessageDTO> {
  const existing = await prisma.outboundMessage.findUnique({ where: { draftId } })

  if (!existing) {
    // The row was deleted (a failed send releasing its claim) between our insert
    // and this read. Treat as in-progress; the caller can retry.
    throw new DraftSendInProgressError()
  }

  if (existing.status === 'SENT') {
    throw new DraftAlreadySentError(existing.id)
  }

  const claimAgeMs = Date.now() - existing.createdAt.getTime()
  if (claimAgeMs < CLAIM_STALE_MS) {
    throw new DraftSendInProgressError()
  }

  // Stale claim — reconcile to SENT without re-sending.
  const reconciled = await prisma.outboundMessage.update({
    where: { id: existing.id },
    data: { status: 'SENT', sentAt: existing.sentAt ?? new Date() },
  })

  // Lead transition is idempotent (auto: trigger no-ops if already advanced),
  // so it is safe to (re)apply on reconciliation.
  await transitionLeadStatus({
    organizationId,
    leadId,
    newStatus: 'CONTACTED',
    trigger: 'auto:message_sent',
    metadata: { messageId: reconciled.id, draftId, reconciledClaim: true },
  })

  return toDTO(reconciled)
}

function toDTO(m: Awaited<ReturnType<typeof prisma.outboundMessage.create>>): OutboundMessageDTO {
  return {
    id: m.id,
    organizationId: m.organizationId,
    leadId: m.leadId,
    mailboxId: m.mailboxId,
    campaignId: m.campaignId,
    draftId: m.draftId,
    sgMessageId: m.sgMessageId,
    subject: m.subject,
    body: m.body,
    status: m.status,
    sentAt: m.sentAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }
}
