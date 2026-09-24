import { prisma } from '@/lib/db/prisma'
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

export async function processSendQueue(now: Date = new Date(), budgetMs = 45_000): Promise<SendQueueResult> {
  const startedAt = Date.now()
  const result: SendQueueResult = { sent: 0, cancelled: 0, deferred: 0, failed: 0, reconciled: 0 }

  // Recover claims abandoned by a crashed invocation.
  await prisma.outboundMessage.updateMany({
    where: { processing: true, processingStartedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
    data: { processing: false, processingStartedAt: null },
  })

  const orgs = await prisma.organization.findMany({
    where: {
      sendingPaused: false,
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
        OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }],
      },
    })

    for (const mailbox of mailboxes) {
      if (total >= MAX_SENDS_PER_TICK || Date.now() - startedAt > budgetMs) return result

      const next = await prisma.outboundMessage.findFirst({
        where: { mailboxId: mailbox.id, status: 'QUEUED', processing: false, scheduledFor: { lte: now } },
        orderBy: { scheduledFor: 'asc' },
        select: { id: true },
      })
      if (!next) continue

      const outcome = await sendOne(next.id, mailbox, org, now)
      if (outcome !== 'skipped') result[outcome]++
      total++
      if (outcome === 'failed' && (await isOrgPaused(org.id))) break
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

  const message = await prisma.outboundMessage.findUnique({
    where: { id: messageId },
    include: {
      lead: { select: { id: true, email: true, status: true } },
      draft: {
        select: {
          sequenceEnrollmentId: true,
          sequenceEnrollment: { select: { id: true, status: true, startedAt: true } },
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
    const state = await getMessageState(org.msTenantId, mailbox.email, message.graphMessageId)
    if (state.state === 'SENT') {
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
      try {
        await sendDraftMessage(org.msTenantId, mailbox.email, message.graphMessageId)
      } catch (err) {
        await releaseMailboxSlot(mailbox.id)
        return handleSendError(err, messageId, message.sendAttempts, mailbox.id, org.id, now)
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
    // MISSING: the draft was deleted; fall through and send fresh.
  }

  if (!(await reserveMailboxSlot(mailbox.id, limitToday, startOfDay(now)))) {
    return deferForCapacity(messageId, mailbox.id, now)
  }

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
  } catch (err) {
    await releaseMailboxSlot(mailbox.id)
    return handleSendError(err, messageId, message.sendAttempts, mailbox.id, org.id, now)
  }

  await finalizeSent(messageId, message.leadId, message.organizationId, {
    graphMessageId: sent.providerMessageId ?? null,
    conversationId: sent.conversationId ?? null,
    subject,
    sendAttempts: message.sendAttempts + 1,
  })
  await paceMailbox()
  return 'sent'
}

async function finalizeSent(
  messageId: string,
  leadId: string,
  organizationId: string,
  f: { graphMessageId: string | null; conversationId: string | null; subject: string; sendAttempts: number },
): Promise<void> {
  await prisma.outboundMessage.update({
    where: { id: messageId },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      subject: f.subject,
      sendAttempts: f.sendAttempts,
      processing: false,
      processingStartedAt: null,
      lastError: null,
      ...(f.graphMessageId && { graphMessageId: f.graphMessageId }),
      ...(f.conversationId && { conversationId: f.conversationId }),
    },
  })
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
      `Microsoft 365 rejected OutboundOS (HTTP ${err.status}: ${err.message}). Check the app registration's admin consent, client secret expiry, and the Sending Mailboxes access policy.`,
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
