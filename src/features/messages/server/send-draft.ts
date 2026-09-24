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
  DraftOnSendQueueError,
  MissingPostalAddressError,
  DomainNotHealthyError,
  EmailNotVerifiedError,
} from '../types'
import { DraftNotFoundError } from '@/features/drafts/types'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { TERMINAL_STATUSES, LeadExcludedCanadaError } from '@/features/leads/types'
import { canadaExclusionReason } from '@/features/leads/canada'
import { LeadInTerminalStateError } from '../types'
import { effectiveDailyLimit } from '@/features/mailboxes/warmup'
import { getDomainHealthMap, domainOf } from '@/features/deliverability/server/domain-health'
import { isDomainUsable } from '@/features/deliverability/readiness'
import { generateMessageId, buildThreadHeaders, buildReplySubject } from '../threading'
import { startOfDay, reserveMailboxSlot, releaseMailboxSlot } from '@/features/mailboxes/server/mailbox-slots'
import { assignEnrollmentMailbox } from '@/features/sequences/server/assign-mailbox'
import { verificationGate } from '@/features/verification/gate'
import { isVerificationConfigured } from '@/features/verification/server/get-verifier'
import { queueLeadForVerification } from '@/features/verification/server/queue-verification'

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
    include: {
      lead: {
        select: {
          id: true,
          email: true,
          status: true,
          phone: true,
          country: true,
          customFields: true,
          emailCheck: true,
          emailCheckResult: true,
          emailCheckedAt: true,
        },
      },
    },
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

  // 2c. A draft already on the automatic send queue is owned by the queue —
  //     refuse up front (before any mailbox work) and leave its message alone.
  const queued = await prisma.outboundMessage.findUnique({
    where: { draftId },
    select: { id: true, status: true, scheduledFor: true },
  })
  if (queued?.scheduledFor) {
    throw new DraftOnSendQueueError(queued.status, queued.id)
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      msTenantId: true,
      businessName: true,
      postalAddress: true,
      allowCanadianRecipients: true,
      blockRiskyEmails: true,
    },
  })

  // 2d. Compliance gates (CAN-SPAM postal address, CASL Canadian recipients).
  const postalAddress = org?.postalAddress?.trim()
  if (!org || !postalAddress) {
    throw new MissingPostalAddressError()
  }
  if (!org.allowCanadianRecipients) {
    const canadaReason = canadaExclusionReason(draft.lead)
    if (canadaReason) throw new LeadExcludedCanadaError(draft.leadId, canadaReason)
  }

  // 2e. Email verification (first email to this lead only).
  if (isVerificationConfigured()) {
    const emailedBefore = await prisma.outboundMessage.findFirst({
      where: { organizationId, leadId: draft.leadId, sentAt: { not: null } },
      select: { id: true },
    })
    if (!emailedBefore) {
      const decision = verificationGate(draft.lead, { blockRiskyEmails: org.blockRiskyEmails }, true)
      if (decision.action === 'stop') throw new EmailNotVerifiedError('stop', decision.reason)
      if (decision.action === 'wait') {
        await queueLeadForVerification(prisma, draft.leadId)
        throw new EmailNotVerifiedError('wait', "This lead's email address is being verified. Try again in a few minutes.")
      }
    }
  }

  // THREADING (RFC 5322): every send gets its own Message-ID. For a follow-up in
  // the same sequence enrollment (the thread), we set In-Reply-To = the prior
  // message and References = the full prior chain (oldest→newest), and reuse the
  // original thread subject as "Re: <subject>". The first email in a sequence (no
  // prior sent messages) gets only its own Message-ID. Drafts not tied to a
  // sequence enrollment never thread.
  const messageId = generateMessageId()
  const priorMessages = draft.sequenceEnrollmentId
    ? await prisma.outboundMessage.findMany({
        where: {
          organizationId,
          status: 'SENT',
          messageId: { not: null },
          draft: { sequenceEnrollmentId: draft.sequenceEnrollmentId },
        },
        orderBy: { sentAt: 'asc' },
        select: { messageId: true, subject: true, graphMessageId: true, mailboxId: true },
      })
    : []
  const priorMessageIds = priorMessages
    .map((m) => m.messageId)
    .filter((id): id is string => id !== null)
  const { inReplyTo, references } = buildThreadHeaders(priorMessageIds)
  // Graph threads by replying to the most recent prior message it sent.
  const replyToProviderMessageId =
    [...priorMessages].reverse().find((m) => m.graphMessageId)?.graphMessageId ?? undefined
  // Reuse the thread's original subject (oldest message) as "Re: ..."; never
  // double-prefix. First send keeps the draft's own subject.
  const threadRoot = priorMessages[0]
  const effectiveSubject = threadRoot ? buildReplySubject(threadRoot.subject) : draft.subject

  // 3. Select the sending mailbox.
  //    - Sequence drafts are PINNED to the enrollment's mailbox (the one that
  //      sent earlier steps): a follow-up must come from the same inbox so
  //      Graph can reply in-thread and replies land where we monitor. No
  //      fallback to another mailbox — if it can't send, report capacity.
  //    - Other drafts rotate across the org's active mailboxes (volume
  //      scaling and reputation spreading).
  // Exclude both user-disabled (isActive: false) and breaker-paused
  // (autoPaused: true) mailboxes — neither can be selected or reserved. A
  // Microsoft 365 org only sends from Graph mailboxes.
  const graphOnly = !!org?.msTenantId
  // Domain health (Microsoft 365 orgs): never send from a mailbox whose domain
  // fails SPF/DKIM/MX or was never verified. Pinned follow-ups fail loudly;
  // rotation drops blocked mailboxes and fails only if none remain. Computed
  // up front so the pinned branch below can also use it (a fresh enrollment
  // whose only candidate mailboxes are all domain-blocked must report THAT,
  // not a generic "no active mailbox").
  const domainHealth = graphOnly ? await getDomainHealthMap(organizationId) : null
  const domainFor = (m: { email: string }) => (domainHealth ? domainHealth.get(domainOf(m.email)) ?? null : null)

  let mailboxes: Awaited<ReturnType<typeof prisma.mailbox.findMany>>
  if (draft.sequenceEnrollmentId) {
    const pinnedId = await resolveEnrollmentMailboxId(organizationId, draft.sequenceEnrollmentId, priorMessages)
    if (!pinnedId) {
      if (domainHealth) {
        const activeGraphMailboxes = await prisma.mailbox.findMany({
          where: { organizationId, isActive: true, autoPaused: false, provider: 'MICROSOFT_GRAPH' as const },
          select: { email: true },
        })
        if (
          activeGraphMailboxes.length > 0 &&
          activeGraphMailboxes.every((m) => !isDomainUsable(domainFor(m)?.status))
        ) {
          const first = activeGraphMailboxes[0]!
          throw new DomainNotHealthyError(domainOf(first.email), domainFor(first)?.status ?? 'UNVERIFIED')
        }
      }
      throw new NoActiveMailboxError()
    }
    const pinned = await prisma.mailbox.findFirst({ where: { id: pinnedId, organizationId } })
    if (!pinned || !pinned.isActive || pinned.autoPaused || (graphOnly && pinned.provider !== 'MICROSOFT_GRAPH')) {
      throw new MailboxLimitExceededError(
        `The mailbox this sequence sends from (${pinned?.email ?? 'unknown'}) is paused or inactive, so this follow-up can't be sent right now.`,
      )
    }
    mailboxes = [pinned]
  } else {
    mailboxes = await prisma.mailbox.findMany({
      where: { organizationId, isActive: true, autoPaused: false, ...(graphOnly && { provider: 'MICROSOFT_GRAPH' as const }) },
    })
    if (mailboxes.length === 0) {
      throw new NoActiveMailboxError()
    }
  }

  if (domainHealth) {
    const blocked = mailboxes.filter((m) => !isDomainUsable(domainFor(m)?.status))
    mailboxes = mailboxes.filter((m) => isDomainUsable(domainFor(m)?.status))
    if (mailboxes.length === 0) {
      const first = blocked[0]!
      throw new DomainNotHealthyError(domainOf(first.email), domainFor(first)?.status ?? 'UNVERIFIED')
    }
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

  // Only mailboxes that still have headroom under TODAY'S limit are eligible.
  // effectiveDailyLimit applies the warmup ramp: a warming mailbox's limit today
  // may be well below its configured dailyLimit, so cold mailboxes don't blast
  // full volume. A mailbox with warmup off uses its dailyLimit directly.
  const candidates = withUsage.filter(
    (c) => c.effectiveSentToday < effectiveDailyLimit(c.mailbox, now, domainFor(c.mailbox)),
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

  // A/B test attribution: carry the assigned variant onto the OutboundMessage
  // (the row events join to) ONLY for a genuine first send with an UNEDITED
  // subject. Threaded follow-ups (threadRoot set) and reviewer-edited subjects
  // (draft.subjectEdited) are excluded so they never pollute a variant's stats.
  const subjectVariantId =
    !threadRoot && draft.subjectVariantId && !draft.subjectEdited ? draft.subjectVariantId : null

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
        ...(subjectVariantId && { subjectVariantId }),
        subject: effectiveSubject,
        body: draft.body,
        status: 'QUEUED',
        messageId,
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
    // Guard the atomic reservation on TODAY'S effective (ramped) limit, not the
    // raw dailyLimit. The effective limit is computed in JS and passed as the
    // literal bound in the conditional UPDATE's WHERE, so the reservation stays
    // atomic: at most `effectiveLimitToday` increments can succeed today.
    const effectiveLimitToday = effectiveDailyLimit(c.mailbox, now, domainFor(c.mailbox))
    if (await reserveMailboxSlot(c.mailbox.id, effectiveLimitToday, startOfToday)) {
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
  let sent: Awaited<ReturnType<ReturnType<typeof getEmailProvider>['sendEmail']>>
  try {
    sent = await getEmailProvider({ msTenantId: org?.msTenantId }).sendEmail({
      to: draft.lead.email,
      fromEmail: sendingMailbox.email,
      fromName: sendingMailbox.displayName,
      subject: effectiveSubject,
      body: draft.body,
      customArgs: { draftId, leadId: draft.leadId },
      listUnsubscribe: { url: unsubscribeUrl },
      sender: { businessName: org.businessName, postalAddress },
      messageId,
      ...(inReplyTo && { inReplyTo }),
      ...(references && references.length > 0 && { references }),
      ...(replyToProviderMessageId && { replyToProviderMessageId }),
      onPrepared: async (providerMessageId) => {
        await prisma.outboundMessage.update({ where: { id: claim.id }, data: { graphMessageId: providerMessageId } })
      },
    })
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
      data: {
        status: 'SENT',
        sgMessageId: sent.sgMessageId,
        sentAt,
        mailboxId: sendingMailbox.id,
        ...(sent.providerMessageId && { graphMessageId: sent.providerMessageId }),
        ...(sent.conversationId && { conversationId: sent.conversationId }),
      },
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

/**
 * The mailbox a sequence enrollment sends from: the one that sent its most
 * recent message, else the enrollment's assigned mailbox, else a fresh sticky
 * assignment (persisted on the enrollment).
 */
async function resolveEnrollmentMailboxId(
  organizationId: string,
  enrollmentId: string,
  priorMessages: { mailboxId: string }[],
): Promise<string | null> {
  const lastSent = priorMessages[priorMessages.length - 1]
  if (lastSent) return lastSent.mailboxId
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId, organizationId },
    select: { mailboxId: true },
  })
  if (enrollment?.mailboxId) return enrollment.mailboxId
  if (!enrollment) return null
  return assignEnrollmentMailbox(organizationId, enrollmentId)
}

// How long a QUEUED claim is treated as an in-flight send. A claim older than
// this is considered abandoned (the sending process crashed, or its finalize
// UPDATE never landed) and is reconciled rather than treated as concurrent.
// Comfortably longer than a provider call + finalize, well under any human retry.
const CLAIM_STALE_MS = 2 * 60 * 1000

/**
 * A claim row already exists for this draft (the claiming insert hit the unique
 * draftId constraint). Resolve it WITHOUT ever re-sending:
 *  - scheduledFor set       → a send-queue message, never a manual claim →
 *                             DraftOnSendQueueError (untouched).
 *  - past QUEUED (SENT, …)  → the send already completed → DraftAlreadySentError.
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

  // A row with scheduledFor belongs to the automatic send queue, not to a
  // manual claim. Never reconcile it: a QUEUED one is still going to send (or
  // is mid-send), and a FAILED one never went out and must be retried through
  // the queue. Marking either SENT here would silently drop the email.
  if (existing.scheduledFor) {
    throw new DraftOnSendQueueError(existing.status, existing.id)
  }

  // Any manual row past QUEUED (SENT, or advanced by delivery events) has
  // already gone out.
  if (existing.status !== 'QUEUED') {
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
