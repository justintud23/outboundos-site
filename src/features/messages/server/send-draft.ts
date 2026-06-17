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

function startOfDay(d: Date): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

/**
 * Atomically reserve one daily-send slot on a mailbox. Returns true iff a slot
 * was claimed. Two conditional updates, each atomic at the row level (so they
 * are race-free under concurrency, exactly like the sequence-runner's claim):
 *
 *   1. Lazy reset — zero sentToday at most ONCE per day. The `lastResetAt < startOfToday`
 *      guard means the first concurrent send of a new day resets the counter and
 *      stamps lastResetAt=startOfToday; every other concurrent send then sees a
 *      non-stale lastResetAt and its reset is a no-op. No read-modify-write, so
 *      no lost reset and no double-reset.
 *   2. Conditional increment — bump sentToday ONLY while it is below the limit.
 *      Because the guard lives in the WHERE clause, the database serializes the
 *      row updates: at most `dailyLimit` increments can ever succeed, no matter
 *      how many sends race. count === 0 means the mailbox just filled up.
 */
async function reserveMailboxSlot(
  mailboxId: string,
  dailyLimit: number,
  startOfToday: Date,
): Promise<boolean> {
  await prisma.mailbox.updateMany({
    where: { id: mailboxId, lastResetAt: { lt: startOfToday } },
    data: { sentToday: 0, lastResetAt: startOfToday },
  })

  const reservation = await prisma.mailbox.updateMany({
    where: { id: mailboxId, sentToday: { lt: dailyLimit } },
    data: { sentToday: { increment: 1 } },
  })

  return reservation.count === 1
}

/**
 * Release a previously reserved slot (atomic decrement, guarded so it can never
 * underflow below 0). Used to roll back a reservation when the send fails.
 */
async function releaseMailboxSlot(mailboxId: string): Promise<void> {
  await prisma.mailbox.updateMany({
    where: { id: mailboxId, sentToday: { gt: 0 } },
    data: { sentToday: { decrement: 1 } },
  })
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

  const now = new Date()
  const startOfToday = startOfDay(now)

  // Lazy daily reset (snapshot, for SELECTION ONLY): a mailbox last reset before
  // today is treated as having sent 0 today when ordering candidates. The
  // authoritative reset and the limit enforcement happen atomically at
  // reservation time below, not here.
  const withUsage = mailboxes.map((m) => {
    const isNewDay = m.lastResetAt < startOfToday
    return { mailbox: m, effectiveSentToday: isNewDay ? 0 : m.sentToday }
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

  const tentative = candidates[0]
  if (!tentative) {
    // Every active mailbox is already at its daily limit (per snapshot).
    throw new MailboxLimitExceededError()
  }

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
  //    The draft claim comes BEFORE the mailbox reservation so a duplicate send
  //    reports DraftAlreadySent/InProgress rather than a misleading capacity
  //    error. mailboxId is provisional (the reservation below may roll to
  //    another mailbox) and is corrected at finalize.
  let claim: Awaited<ReturnType<typeof prisma.outboundMessage.create>>
  try {
    claim = await prisma.outboundMessage.create({
      data: {
        organizationId,
        leadId: draft.leadId,
        mailboxId: tentative.mailbox.id,
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

  // 5. RESERVE a daily slot atomically BEFORE the send — we are now claiming
  //    capacity, not just recording it afterward. reserveMailboxSlot does a
  //    conditional increment guarded by the limit in the WHERE clause (mirroring
  //    the sequence-runner's atomic claim), so even with many simultaneous sends
  //    competing for the same mailbox it is IMPOSSIBLE for more than dailyLimit
  //    increments to succeed. If the LRU mailbox fills between selection and
  //    reservation, roll to the next eligible mailbox in order.
  let reserved: (typeof candidates)[number]['mailbox'] | null = null
  for (const c of candidates) {
    if (await reserveMailboxSlot(c.mailbox.id, c.mailbox.dailyLimit, startOfToday)) {
      reserved = c.mailbox
      break
    }
  }
  if (!reserved) {
    // Every eligible mailbox filled up before we could reserve. Release the
    // draft claim so the draft stays retryable, and report capacity.
    await prisma.outboundMessage.delete({ where: { id: claim.id } }).catch(() => {})
    throw new MailboxLimitExceededError()
  }
  const sendingMailbox = reserved

  // 6. Send via provider. We own both the draft claim and a mailbox slot.
  let sgMessageId: string | null
  try {
    ;({ sgMessageId } = await getEmailProvider().sendEmail({
      to: draft.lead.email,
      fromEmail: sendingMailbox.email,
      fromName: sendingMailbox.displayName,
      subject: draft.subject,
      body: draft.body,
      customArgs: { draftId, leadId: draft.leadId },
      listUnsubscribe: { url: unsubscribeUrl },
    }))
  } catch (sendErr) {
    // DEFINITE failure: the provider threw, so no email went out. Roll BOTH
    // pre-send reservations back: release the mailbox slot (atomic decrement) so
    // a transient failure doesn't permanently consume daily quota, and delete
    // the QUEUED claim row so a deliberate retry can re-claim and re-send.
    await releaseMailboxSlot(sendingMailbox.id).catch((relErr) => {
      console.error(`[sendDraft] Failed to release mailbox slot ${sendingMailbox.id} after send error:`, relErr)
    })
    await prisma.outboundMessage.delete({ where: { id: claim.id } }).catch((delErr) => {
      console.error(`[sendDraft] Failed to release claim ${claim.id} after send error:`, delErr)
    })
    throw sendErr
  }

  // 7. FINALIZE: flip the claim QUEUED -> SENT, fill sgMessageId, correct the
  //    mailboxId to whichever mailbox we actually reserved, and write the
  //    AuditLog — atomically. The mailbox counter is NOT touched here: it was
  //    already incremented exactly once by the reservation in step 5.
  const sentAt = new Date()
  const finalized = await prisma.$transaction(async (tx) => {
    const message = await tx.outboundMessage.update({
      where: { id: claim.id },
      data: { status: 'SENT', sgMessageId, sentAt, mailboxId: sendingMailbox.id },
    })

    await tx.auditLog.create({
      data: {
        organizationId,
        actorClerkId: clerkUserId,
        action: 'message.sent',
        entityType: 'OutboundMessage',
        entityId: message.id,
        metadata: { draftId, leadId: draft.leadId, mailboxId: sendingMailbox.id },
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
