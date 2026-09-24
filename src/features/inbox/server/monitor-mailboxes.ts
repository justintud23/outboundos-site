import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { MS_AUTH_PAUSE_PREFIX } from '@/lib/cron'
import { fetchFolderDelta, type GraphMessage } from '@/lib/email/graph/mail'
import { GraphAuthError, GraphError, GraphThrottledError } from '@/lib/email/graph/client'
import { classifyInboundMessage, extractBouncedRecipients, type InboundMessage } from '../classify-inbound'
import { recordReply } from '@/features/replies/server/record-reply'
import { notifyReply, notifyUnmatchedReply } from '@/features/replies/server/notify'
import { pauseOrgSending } from '@/features/messages/server/process-send-queue'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { evaluateMailboxBreaker } from '@/features/mailboxes/server/evaluate-mailbox-breaker'

export const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000
const RESWEEP_WINDOW_MS = 24 * 60 * 60 * 1000
const NO_NOTIFY = new Set(['UNSUBSCRIBE_REQUEST', 'OUT_OF_OFFICE'])

export interface MonitorResult {
  mailboxes: number
  replies: number
  unmatched: number
  bounces: number
  autoReplies: number
  handled: number
  notified: number
  errors: number
  failedMailboxes: string[]
}

type MailboxWithOrg = {
  id: string
  organizationId: string
  email: string
  inboxDeltaLink: string | null
  sentDeltaLink: string | null
  organization: { msTenantId: string | null; mailboxes: { email: string }[] }
}

export async function monitorMailboxes(now: Date = new Date(), budgetMs = 25_000): Promise<MonitorResult> {
  const startedAt = Date.now()
  const result: MonitorResult = {
    mailboxes: 0, replies: 0, unmatched: 0, bounces: 0, autoReplies: 0, handled: 0, notified: 0,
    errors: 0, failedMailboxes: [],
  }

  const mailboxes = (await prisma.mailbox.findMany({
    where: { provider: 'MICROSOFT_GRAPH', organization: { msTenantId: { not: null } } },
    orderBy: { lastPolledAt: { sort: 'asc', nulls: 'first' } },
    select: {
      id: true, organizationId: true, email: true, inboxDeltaLink: true, sentDeltaLink: true,
      organization: { select: { msTenantId: true, mailboxes: { select: { email: true } } } },
    },
  })) as MailboxWithOrg[]

  for (const mailbox of mailboxes) {
    if (Date.now() - startedAt > budgetMs) break
    try {
      await pollMailbox(mailbox, now, result)
      result.mailboxes++
    } catch (err) {
      if (err instanceof GraphAuthError) {
        await pauseOrgSending(
          mailbox.organizationId,
          `${MS_AUTH_PAUSE_PREFIX} denied OutboundOS access to ${mailbox.email} (HTTP ${err.status}: ${err.message}). Check admin consent and the Sending Mailboxes access policy.`,
        )
      } else if (err instanceof GraphError && err.status === 410) {
        await prisma.mailbox.update({ where: { id: mailbox.id }, data: { inboxDeltaLink: null, sentDeltaLink: null } })
      } else if (!(err instanceof GraphThrottledError)) {
        // Anything else is an unexpected failure mid-poll: the delta link was
        // deliberately not saved above, so the next tick retries this
        // mailbox from the same point. Surface it in the result so a run of
        // silent failures shows up instead of just going quiet.
        console.error(`[inbox-monitor] mailbox ${mailbox.email} failed`, err)
        result.errors++
        result.failedMailboxes.push(mailbox.email)
      }
    }
  }

  // Re-sweep notifications that failed on an earlier tick. Best-effort: a
  // throwing notifier here must never turn a tick that otherwise succeeded
  // into a 500.
  try {
    const since = new Date(now.getTime() - RESWEEP_WINDOW_MS)
    const pending = await prisma.inboundReply.findMany({
      where: {
        notifiedAt: null,
        graphMessageId: { not: null },
        createdAt: { gte: since },
        classification: { notIn: ['UNSUBSCRIBE_REQUEST', 'OUT_OF_OFFICE'] },
      },
      select: { id: true },
      take: 20,
    })
    for (const r of pending) if (await notifyReply(r.id)) result.notified++
    const pendingUnmatched = await prisma.unmatchedReply.findMany({
      where: { notifiedAt: null, createdAt: { gte: since } },
      select: { id: true },
      take: 20,
    })
    for (const u of pendingUnmatched) if (await notifyUnmatchedReply(u.id)) result.notified++
  } catch (err) {
    console.error('[inbox-monitor] re-sweep', err)
  }

  return result
}

async function pollMailbox(mailbox: MailboxWithOrg, now: Date, result: MonitorResult): Promise<void> {
  const tenantId = mailbox.organization.msTenantId!
  const since = new Date(now.getTime() - INITIAL_LOOKBACK_MS)
  const own = new Set(
    [...mailbox.organization.mailboxes.map((m) => m.email), process.env.MS_NOTIFY_MAILBOX ?? '']
      .filter(Boolean)
      .map((e) => e.toLowerCase()),
  )

  const inbox = await fetchFolderDelta(tenantId, mailbox.email, 'inbox', mailbox.inboxDeltaLink, since)
  for (const msg of inbox.messages) {
    if (msg['@removed']) continue
    await processInbound(mailbox, msg, own, result)
  }

  const sent = await fetchFolderDelta(tenantId, mailbox.email, 'sentitems', mailbox.sentDeltaLink, since)
  await processSent(mailbox, sent.messages.filter((m) => !m['@removed']), result)

  await prisma.mailbox.update({
    where: { id: mailbox.id },
    data: { inboxDeltaLink: inbox.resumeLink, sentDeltaLink: sent.resumeLink, lastPolledAt: now },
  })
}

function toInbound(msg: GraphMessage): InboundMessage {
  const headers: Record<string, string> = {}
  for (const h of msg.internetMessageHeaders ?? []) headers[h.name.toLowerCase()] = h.value
  return {
    fromAddress: msg.from?.emailAddress?.address ?? '',
    subject: msg.subject ?? '',
    bodyText: msg.body?.content ?? msg.bodyPreview ?? '',
    headers,
  }
}

async function processInbound(
  mailbox: MailboxWithOrg,
  msg: GraphMessage,
  own: ReadonlySet<string>,
  result: MonitorResult,
): Promise<void> {
  const inbound = toInbound(msg)
  const kind = classifyInboundMessage(inbound, own)
  const orgId = mailbox.organizationId

  if (kind === 'INTERNAL') return

  if (kind === 'AUTO_REPLY') {
    await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        action: 'reply.auto_reply',
        entityType: 'Mailbox',
        entityId: mailbox.id,
        metadata: { graphMessageId: msg.id, from: inbound.fromAddress, subject: inbound.subject },
      },
    })
    result.autoReplies++
    return
  }

  if (kind === 'BOUNCE') {
    const recipients = extractBouncedRecipients(inbound.bodyText, own)
    if (recipients.length === 0) return
    const original = await prisma.outboundMessage.findFirst({
      where: {
        mailboxId: mailbox.id,
        status: { in: ['SENT', 'DELIVERED'] },
        lead: { email: { in: recipients, mode: 'insensitive' } },
      },
      orderBy: { sentAt: 'desc' },
      select: { id: true, leadId: true },
    })
    if (!original) return
    // A P2002 here means a previous attempt already recorded this NDR (and
    // may have crashed before finishing the update/transition/breaker below
    // — those are all idempotent, so re-run them instead of bailing out;
    // only the double count is skipped.
    let alreadyRecorded = false
    try {
      await prisma.messageEvent.create({
        data: {
          organizationId: orgId,
          outboundMessageId: original.id,
          // sgEventId is the provider-event dedupe key; Graph NDRs use their message id.
          sgEventId: `graph:${msg.id}`,
          eventType: 'BOUNCED',
          providerEventType: 'graph_ndr',
          providerTimestamp: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
          rawPayload: { subject: inbound.subject, recipients },
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        alreadyRecorded = true
      } else {
        throw err
      }
    }
    await prisma.outboundMessage.update({ where: { id: original.id }, data: { status: 'BOUNCED' } })
    await transitionLeadStatus({
      organizationId: orgId,
      leadId: original.leadId,
      newStatus: 'BOUNCED',
      trigger: 'auto:bounce',
      metadata: { outboundMessageId: original.id },
    })
    // evaluateMailboxBreaker is best-effort — a breaker failure must never
    // block bounce processing. try/catch (not `.catch` on the call result)
    // because it must not assume the awaited value is always a real Promise.
    try {
      await evaluateMailboxBreaker(mailbox.id)
    } catch (err) {
      console.error('[inbox-monitor] breaker', err)
    }
    if (!alreadyRecorded) result.bounces++
    return
  }

  // HUMAN. Resolve the lead first (before the dedupe check) so that both the
  // dedupe path and the normal path can stop/cancel for it.
  const fromEmail = inbound.fromAddress.toLowerCase()
  const byConversation = msg.conversationId
    ? await prisma.outboundMessage.findFirst({
        where: { organizationId: orgId, conversationId: msg.conversationId },
        select: { id: true, leadId: true },
      })
    : null
  const leadId =
    byConversation?.leadId ??
    (await prisma.lead.findFirst({
      where: { organizationId: orgId, email: { equals: fromEmail, mode: 'insensitive' } },
      select: { id: true },
    }))?.id

  if (!leadId) {
    const unmatched = await prisma.unmatchedReply.upsert({
      where: { graphMessageId: msg.id },
      create: {
        organizationId: orgId,
        mailboxId: mailbox.id,
        graphMessageId: msg.id,
        conversationId: msg.conversationId ?? null,
        fromEmail,
        subject: inbound.subject,
        bodyPreview: inbound.bodyText.slice(0, 2000),
        receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
      },
      update: {},
    })
    if (!unmatched.notifiedAt) await notifyUnmatchedReply(unmatched.id)
    result.unmatched++
    return
  }

  // Dedupe: a previous attempt may already have recorded this message and
  // then crashed before stopping the sequence / cancelling queued mail (see
  // the ordering note below) — repair that here instead of just bailing out.
  // Notification is intentionally skipped on this path; the re-sweep above
  // picks up anything whose notifiedAt is still null.
  const existing = await prisma.inboundReply.findUnique({ where: { graphMessageId: msg.id }, select: { id: true } })
  if (existing) {
    await stopEnrollmentsAndCancelQueued(leadId, orgId)
    return
  }

  // Stop everything for this lead BEFORE recording the reply — not after.
  // recordReply persists the InboundReply row and then calls
  // transitionLeadStatus itself; if anything after the row is saved throws,
  // a retry would hit the dedupe branch above and return early, so the stop
  // must not depend on recordReply having returned successfully.
  await stopEnrollmentsAndCancelQueued(leadId, orgId)

  let reply: { id: string; classification: string }
  try {
    reply = await recordReply({
      organizationId: orgId,
      leadId,
      outboundMessageId: byConversation?.id ?? null,
      rawBody: inbound.bodyText.slice(0, 50_000),
      receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : undefined,
      mailboxId: mailbox.id,
      graphMessageId: msg.id,
      conversationId: msg.conversationId ?? null,
      fromEmail,
      subject: inbound.subject,
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return // processed concurrently; already stopped above
    throw err
  }

  result.replies++
  if (!NO_NOTIFY.has(reply.classification)) await notifyReply(reply.id)
}

async function stopEnrollmentsAndCancelQueued(leadId: string, organizationId: string): Promise<void> {
  await prisma.sequenceEnrollment.updateMany({
    where: { leadId, organizationId, status: 'ACTIVE' },
    data: { status: 'STOPPED', stoppedAt: new Date(), stoppedReason: 'reply_received' },
  })
  await prisma.outboundMessage.updateMany({
    where: { leadId, organizationId, status: 'QUEUED', processing: false },
    data: { status: 'CANCELLED', lastError: 'reply_received' },
  })
}

async function processSent(mailbox: MailboxWithOrg, messages: GraphMessage[], result: MonitorResult): Promise<void> {
  if (messages.length === 0) return
  const ours = await prisma.outboundMessage.findMany({
    where: { graphMessageId: { in: messages.map((m) => m.id) } },
    select: { graphMessageId: true },
  })
  const ourIds = new Set(ours.map((o) => o.graphMessageId))

  for (const m of messages) {
    if (ourIds.has(m.id) || !m.conversationId) continue
    const handledAt = m.sentDateTime ? new Date(m.sentDateTime) : new Date()
    const r = await prisma.inboundReply.updateMany({
      where: { organizationId: mailbox.organizationId, conversationId: m.conversationId, handledAt: null },
      data: { handledAt },
    })
    const u = await prisma.unmatchedReply.updateMany({
      where: { organizationId: mailbox.organizationId, conversationId: m.conversationId, handledAt: null },
      data: { handledAt },
    })
    result.handled += r.count + u.count
  }
}
