import { prisma } from '@/lib/db/prisma'
import { MS_AUTH_PAUSE_PREFIX } from '@/lib/cron'
import { getEmailProvider } from '@/lib/email'
import { getMessageState, sendDraftMessage } from '@/lib/email/graph/mail'
import { GraphAuthError, GraphThrottledError } from '@/lib/email/graph/client'
import { signUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import { startOfDay, reserveMailboxSlot, releaseMailboxSlot } from '@/features/mailboxes/server/mailbox-slots'
import { effectiveDailyLimit } from '@/features/mailboxes/warmup'
import { checkEnrollmentStop } from '@/features/sequences/server/check-enrollment-stop'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { TERMINAL_STATUSES } from '@/features/leads/types'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { isInSendWindow, mailboxSpacingMs, nextSendAt } from '../send-window'
import { buildReplySubject } from '../threading'

export interface SendQueueResult {
  sent: number
  cancelled: number
  deferred: number
  failed: number
  reconciled: number
}

const MAX_SENDS_PER_TICK = 25
const MAX_SEND_ATTEMPTS = 3
const STALE_LOCK_MS = 10 * 60 * 1000
const CAPACITY_BACKOFF_MS = 60 * 60 * 1000
const ORDER_BACKOFF_MS = 60 * 60 * 1000

type Outcome = keyof SendQueueResult | 'skipped'

export async function pauseOrgSending(organizationId: string, reason: string): Promise<void> {
  const res = await prisma.organization.updateMany({
    where: { id: organizationId, sendingPaused: false },
    data: { sendingPaused: true, pausedReason: reason },
  })
  // Only the transition to paused alerts, so a burst of auth errors sends one email.
  if (res.count === 1) {
    await sendOrgAlert(
      organizationId,
      'Sending paused',
      `${reason}\n\nNothing will send until this is fixed and sending is resumed in Settings.`,
    )
  }
}

export async function processSendQueue(now: Date = new Date(), budgetMs = 25_000): Promise<SendQueueResult> {
  const startedAt = Date.now()
  const result: SendQueueResult = { sent: 0, cancelled: 0, deferred: 0, failed: 0, reconciled: 0 }

  // Recover claims abandoned by a crashed invocation.
  await prisma.outboundMessage.updateMany({
    where: { processing: true, processingStartedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
    data: { processing: false, processingStartedAt: null },
  })

  // The send queue is a Microsoft 365 (Graph) feature — orgs without a
  // connected tenant have nothing here to process.
  const orgs = await prisma.organization.findMany({
    where: {
      sendingPaused: false,
      msTenantId: { not: null },
      outboundMessages: { some: { status: 'QUEUED', scheduledFor: { lte: now } } },
    },
    select: {
      id: true, msTenantId: true, timezone: true, businessHoursStart: true,
      businessHoursEnd: true, sendDays: true, sendingPaused: true,
    },
  })

  let total = 0
  for (const org of orgs) {
    if (!isInSendWindow(now, org)) continue

    const mailboxes = await prisma.mailbox.findMany({
      where: {
        organizationId: org.id,
        isActive: true,
        autoPaused: false,
        // Every org here has a tenant: only Graph mailboxes send (and are
        // monitored for replies).
        provider: 'MICROSOFT_GRAPH',
        OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }],
      },
    })

    for (const mailbox of mailboxes) {
      if (total >= MAX_SENDS_PER_TICK || Date.now() - startedAt > budgetMs) return result

      // One message's unhandled failure must never abort the whole tick —
      // sendOne has its own safety net, but this is defense in depth.
      try {
        const next = await prisma.outboundMessage.findFirst({
          where: {
            mailboxId: mailbox.id,
            status: 'QUEUED',
            processing: false,
            scheduledFor: { lte: now },
            // Turning a campaign's auto-send off holds its queued mail (left
            // QUEUED) until it is turned back on.
            OR: [{ campaignId: null }, { campaign: { is: { autoSend: true } } }],
          },
          orderBy: { scheduledFor: 'asc' },
          select: { id: true },
        })
        if (!next) continue

        const outcome = await sendOne(next.id, mailbox, org, now)
        if (outcome !== 'skipped') result[outcome]++
        total++
        if (outcome === 'failed' && (await isOrgPaused(org.id))) break
      } catch (err) {
        console.error(`[send-queue] mailbox ${mailbox.id}: unhandled error while processing the queue, skipping to next mailbox:`, err)
      }
    }
  }
  return result
}

async function isOrgPaused(organizationId: string): Promise<boolean> {
  const orgs = await prisma.organization.findMany({ where: { id: organizationId, sendingPaused: true }, select: { id: true } })
  return orgs.length > 0
}

type MailboxRow = Awaited<ReturnType<typeof prisma.mailbox.findMany>>[number]
interface OrgRow {
  id: string
  msTenantId: string | null
  timezone: string
  businessHoursStart: number
  businessHoursEnd: number
  sendDays: number[]
}

async function sendOne(messageId: string, mailbox: MailboxRow, org: OrgRow, now: Date): Promise<Outcome> {
  // Atomic claim.
  const claimed = await prisma.outboundMessage.updateMany({
    where: { id: messageId, status: 'QUEUED', processing: false },
    data: { processing: true, processingStartedAt: now },
  })
  if (claimed.count === 0) return 'skipped'

  // slotReserved: a mailbox daily-limit slot is currently held and needs
  // releasing if we bail out before a send actually happens.
  // dispatched: the Graph send call itself succeeded — the prospect may
  // already have this email in their inbox, so from this point on we must
  // NEVER release the claim back to QUEUED (that risks a duplicate send).
  let slotReserved = false
  let dispatched = false

  try {
    const message = await prisma.outboundMessage.findUnique({
      where: { id: messageId },
      include: {
        lead: { select: { id: true, email: true, status: true } },
        draft: {
          select: {
            sequenceEnrollmentId: true,
            sequenceEnrollment: { select: { id: true, status: true, startedAt: true } },
            sequenceStep: { select: { stepNumber: true } },
          },
        },
      },
    })
    if (!message) return 'skipped'

    // Last-moment safety: never email someone who replied, bounced or unsubscribed.
    const enrollment = message.draft?.sequenceEnrollment
    let cancelReason: string | null = null
    if (TERMINAL_STATUSES.includes(message.lead.status)) cancelReason = `lead_${message.lead.status.toLowerCase()}`
    else if (enrollment && enrollment.status === 'STOPPED') cancelReason = 'enrollment_stopped'
    else if (enrollment) {
      const stop = await checkEnrollmentStop({
        enrollment: { startedAt: enrollment.startedAt, leadId: message.leadId, organizationId: message.organizationId },
        leadStatus: message.lead.status,
      })
      if (stop.shouldStop) cancelReason = stop.reason ?? 'stopped'
    }
    if (cancelReason) {
      await prisma.outboundMessage.update({
        where: { id: messageId },
        data: { status: 'CANCELLED', processing: false, lastError: cancelReason },
      })
      return 'cancelled'
    }

    const limitToday = effectiveDailyLimit(mailbox, now)
    const paceMailbox = () =>
      prisma.mailbox.update({
        where: { id: mailbox.id },
        data: { nextSendAt: nextSendAt(now, mailboxSpacingMs(org, limitToday)) },
      })

    // Crash recovery: a previous attempt already created (and maybe sent) a Graph message.
    if (message.graphMessageId && org.msTenantId) {
      let state: Awaited<ReturnType<typeof getMessageState>>
      try {
        state = await getMessageState(org.msTenantId, mailbox.email, message.graphMessageId)
      } catch (err) {
        return await handleSendError(err, messageId, message.sendAttempts, mailbox.id, org.id, now)
      }

      if (state.state === 'SENT') {
        dispatched = true
        await finalizeSent(messageId, message.leadId, message.organizationId, {
          graphMessageId: message.graphMessageId,
          conversationId: state.conversationId,
          subject: message.subject,
          sendAttempts: message.sendAttempts + 1,
        })
        await paceMailbox()
        return 'reconciled'
      }
      if (state.state === 'DRAFT') {
        if (!(await reserveMailboxSlot(mailbox.id, limitToday, startOfDay(now)))) {
          return deferForCapacity(messageId, mailbox.id, now)
        }
        slotReserved = true
        try {
          await sendDraftMessage(org.msTenantId, mailbox.email, message.graphMessageId)
          dispatched = true
        } catch (err) {
          await releaseMailboxSlot(mailbox.id)
          slotReserved = false
          return await handleSendError(err, messageId, message.sendAttempts, mailbox.id, org.id, now)
        }
        await finalizeSent(messageId, message.leadId, message.organizationId, {
          graphMessageId: message.graphMessageId,
          conversationId: state.conversationId,
          subject: message.subject,
          sendAttempts: message.sendAttempts + 1,
        })
        await paceMailbox()
        return 'sent'
      }
      // MISSING: the Graph message no longer exists. It may have already been
      // sent and then deleted from the mailbox — never resend automatically,
      // that risks emailing the prospect twice.
      await prisma.outboundMessage.update({
        where: { id: messageId },
        data: { status: 'FAILED', processing: false, lastError: 'Graph message missing from mailbox; not resent automatically' },
      })
      return 'failed'
    }

    // Ordering: a follow-up never goes out while an earlier step of the same
    // enrollment is still unsent (QUEUED, mid-send or FAILED) — sending it now
    // would start a fresh thread ahead of (or instead of) the email it follows.
    const stepNumber = message.draft?.sequenceStep?.stepNumber
    if (enrollment && stepNumber && stepNumber > 1) {
      const unsentEarlier = await prisma.outboundMessage.count({
        where: {
          organizationId: message.organizationId,
          id: { not: messageId },
          status: { in: ['QUEUED', 'FAILED'] },
          draft: { sequenceEnrollmentId: enrollment.id, sequenceStep: { stepNumber: { lt: stepNumber } } },
        },
      })
      if (unsentEarlier > 0) {
        await prisma.outboundMessage.update({
          where: { id: messageId },
          data: { processing: false, processingStartedAt: null, scheduledFor: new Date(now.getTime() + ORDER_BACKOFF_MS) },
        })
        return 'deferred'
      }
    }

    if (!(await reserveMailboxSlot(mailbox.id, limitToday, startOfDay(now)))) {
      return deferForCapacity(messageId, mailbox.id, now)
    }
    slotReserved = true

    // Threading: follow-ups reply to the most recent message we sent in this enrollment.
    const prior = message.draft?.sequenceEnrollmentId
      ? await prisma.outboundMessage.findMany({
          where: {
            organizationId: message.organizationId,
            status: 'SENT',
            id: { not: messageId },
            draft: { sequenceEnrollmentId: message.draft.sequenceEnrollmentId },
          },
          orderBy: { sentAt: 'asc' },
          select: { subject: true, graphMessageId: true },
        })
      : []
    const root = prior[0]
    const subject = root ? buildReplySubject(root.subject) : message.subject
    const replyToProviderMessageId = [...prior].reverse().find((m) => m.graphMessageId)?.graphMessageId ?? undefined

    const token = signUnsubscribeToken({ leadId: message.leadId, organizationId: message.organizationId })
    const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/unsubscribe?token=${token}`

    let sent: { providerMessageId?: string | null; conversationId?: string | null }
    try {
      sent = await getEmailProvider({ msTenantId: org.msTenantId }).sendEmail({
        to: message.lead.email,
        fromEmail: mailbox.email,
        fromName: mailbox.displayName,
        subject,
        body: message.body,
        listUnsubscribe: { url: unsubscribeUrl },
        ...(message.messageId && { messageId: message.messageId }),
        ...(replyToProviderMessageId && { replyToProviderMessageId }),
        customArgs: { outboundMessageId: messageId, leadId: message.leadId },
        onPrepared: async (providerMessageId) => {
          await prisma.outboundMessage.update({ where: { id: messageId }, data: { graphMessageId: providerMessageId } })
        },
      })
      dispatched = true
    } catch (err) {
      await releaseMailboxSlot(mailbox.id)
      slotReserved = false
      return await handleSendError(err, messageId, message.sendAttempts, mailbox.id, org.id, now)
    }

    await finalizeSent(messageId, message.leadId, message.organizationId, {
      graphMessageId: sent.providerMessageId ?? null,
      conversationId: sent.conversationId ?? null,
      subject,
      sendAttempts: message.sendAttempts + 1,
    })
    await paceMailbox()
    return 'sent'
  } catch (err) {
    console.error(`[send-queue] message ${messageId}: unexpected error, leaving for retry:`, err)
    if (slotReserved && !dispatched) {
      try {
        await releaseMailboxSlot(mailbox.id)
      } catch (cleanupErr) {
        console.error(`[send-queue] message ${messageId}: failed to release mailbox slot during cleanup:`, cleanupErr)
      }
    }
    if (!dispatched) {
      try {
        await prisma.outboundMessage.update({ where: { id: messageId }, data: { processing: false } })
      } catch (cleanupErr) {
        console.error(`[send-queue] message ${messageId}: failed to release processing claim during cleanup:`, cleanupErr)
      }
    }
    return 'deferred'
  }
}

async function finalizeSent(
  messageId: string,
  leadId: string,
  organizationId: string,
  f: { graphMessageId: string | null; conversationId: string | null; subject: string; sendAttempts: number },
): Promise<void> {
  const data = {
    status: 'SENT' as const,
    sentAt: new Date(),
    subject: f.subject,
    sendAttempts: f.sendAttempts,
    processing: false,
    processingStartedAt: null,
    lastError: null,
    ...(f.graphMessageId && { graphMessageId: f.graphMessageId }),
    ...(f.conversationId && { conversationId: f.conversationId }),
  }

  // The send already happened — a failure here must never unclaim the
  // message (that would let it be picked up and sent again). Retry once,
  // and if it still fails, leave processing:true: the next tick's stale-lock
  // recovery will release the claim and crash-recovery will reconcile
  // against Graph Sent Items (graphMessageId is already set) instead of
  // resending.
  let persisted = false
  try {
    await prisma.outboundMessage.update({ where: { id: messageId }, data })
    persisted = true
  } catch (err) {
    console.error(`[send-queue] message ${messageId}: SENT update failed after a successful send, retrying once:`, err)
    try {
      await prisma.outboundMessage.update({ where: { id: messageId }, data })
      persisted = true
    } catch (err2) {
      console.error(`[send-queue] message ${messageId}: SENT update failed twice after a successful send — leaving processing:true for stale-lock reconciliation against Graph Sent Items:`, err2)
    }
  }
  if (!persisted) return

  await prisma.auditLog.create({
    data: { organizationId, action: 'message.sent', entityType: 'OutboundMessage', entityId: messageId, metadata: { leadId, auto: true } },
  })
  await transitionLeadStatus({
    organizationId,
    leadId,
    newStatus: 'CONTACTED',
    trigger: 'auto:message_sent',
    metadata: { messageId },
  })
}

async function deferForCapacity(messageId: string, mailboxId: string, now: Date): Promise<Outcome> {
  await prisma.outboundMessage.update({ where: { id: messageId }, data: { processing: false } })
  await prisma.mailbox.update({ where: { id: mailboxId }, data: { nextSendAt: new Date(now.getTime() + CAPACITY_BACKOFF_MS) } })
  return 'deferred'
}

async function handleSendError(
  err: unknown,
  messageId: string,
  attempts: number,
  mailboxId: string,
  organizationId: string,
  now: Date,
): Promise<Outcome> {
  if (err instanceof GraphThrottledError) {
    const until = new Date(now.getTime() + err.retryAfterSeconds * 1000)
    await prisma.outboundMessage.update({
      where: { id: messageId },
      data: { processing: false, scheduledFor: until, lastError: `throttled: ${err.message}` },
    })
    await prisma.mailbox.update({ where: { id: mailboxId }, data: { nextSendAt: until } })
    return 'deferred'
  }

  if (err instanceof GraphAuthError) {
    await prisma.outboundMessage.update({
      where: { id: messageId },
      data: { processing: false, lastError: `auth: ${err.message}` },
    })
    await pauseOrgSending(
      organizationId,
      `${MS_AUTH_PAUSE_PREFIX} rejected OutboundOS (HTTP ${err.status}: ${err.message}). Check the app registration's admin consent, client secret expiry, and the Sending Mailboxes access policy.`,
    )
    return 'failed'
  }

  const nextAttempts = attempts + 1
  const message = err instanceof Error ? err.message : String(err)
  await prisma.outboundMessage.update({
    where: { id: messageId },
    data: {
      processing: false,
      sendAttempts: nextAttempts,
      lastError: message.slice(0, 500),
      ...(nextAttempts >= MAX_SEND_ATTEMPTS && { status: 'FAILED' }),
    },
  })
  console.error(`[send-queue] message ${messageId} attempt ${nextAttempts} failed:`, err)
  return nextAttempts >= MAX_SEND_ATTEMPTS ? 'failed' : 'deferred'
}
