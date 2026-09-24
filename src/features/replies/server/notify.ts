import { prisma } from '@/lib/db/prisma'
import { sendMailAsText } from '@/lib/email/graph/mail'

// Escalation emails go FROM a shared mailbox in the sending tenant
// (MS_NOTIFY_MAILBOX — no license, never counts against cold-mailbox limits)
// TO the org's escalationEmail. All functions are best-effort: they return
// false instead of throwing so a notification problem never breaks a cron tick;
// the inbox monitor re-sweeps replies whose notifiedAt is still null.

const MAX_QUOTE_CHARS = 2000

export interface ReplyNotificationInput {
  classification: string
  confidence: number | null
  leadName: string
  leadEmail: string
  company: string | null
  title: string | null
  campaignName: string | null
  mailboxEmail: string | null
  replyText: string
  leadUrl: string | null
}

export function buildReplyNotification(i: ReplyNotificationInput): { subject: string; text: string } {
  const who = i.company ? `${i.leadName} @ ${i.company}` : i.leadName
  const trimmed = i.replyText.trim()
  const clipped = trimmed.length > MAX_QUOTE_CHARS ? `${trimmed.slice(0, MAX_QUOTE_CHARS)}…` : trimmed
  const quoted = clipped
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

  const lines = [
    `${i.leadName} <${i.leadEmail}>${i.title ? `, ${i.title}` : ''}${i.company ? ` at ${i.company}` : ''} replied.`,
    '',
    `Classification: ${i.classification}${i.confidence !== null ? ` (${Math.round(i.confidence * 100)}% confidence)` : ''}`,
    ...(i.campaignName ? [`Campaign: ${i.campaignName}`] : []),
    ...(i.mailboxEmail ? [`Answer from this mailbox in Outlook: ${i.mailboxEmail}`] : []),
    ...(i.leadUrl ? [`Lead in OutboundOS: ${i.leadUrl}`] : []),
    '',
    quoted,
  ]
  return { subject: `[Reply – ${i.classification}] ${who}`, text: lines.join('\n') }
}

async function deliver(organizationId: string, subject: string, text: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { escalationEmail: true, msTenantId: true },
  })
  const from = process.env.MS_NOTIFY_MAILBOX
  if (!org?.escalationEmail || !org.msTenantId || !from) {
    console.warn(`[notify] org ${organizationId}: missing escalationEmail, msTenantId or MS_NOTIFY_MAILBOX — skipped`)
    return false
  }
  try {
    await sendMailAsText(org.msTenantId, from, org.escalationEmail, subject, text)
    return true
  } catch (err) {
    console.error(`[notify] org ${organizationId}: send failed`, err)
    return false
  }
}

function leadUrl(leadId: string): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL
  return base ? `${base}/leads/${leadId}` : null
}

export async function notifyReply(replyId: string): Promise<boolean> {
  try {
    const reply = await prisma.inboundReply.findUnique({
      where: { id: replyId },
      include: {
        lead: { select: { firstName: true, lastName: true, email: true, company: true, title: true } },
        mailbox: { select: { email: true } },
        outboundMessage: { select: { campaign: { select: { name: true } } } },
      },
    })
    if (!reply || reply.notifiedAt) return false

    const leadName = [reply.lead.firstName, reply.lead.lastName].filter(Boolean).join(' ') || reply.lead.email
    const { subject, text } = buildReplyNotification({
      classification: reply.classification,
      confidence: reply.classificationConfidence,
      leadName,
      leadEmail: reply.lead.email,
      company: reply.lead.company,
      title: reply.lead.title,
      campaignName: reply.outboundMessage?.campaign?.name ?? null,
      mailboxEmail: reply.mailbox?.email ?? null,
      replyText: reply.rawBody,
      leadUrl: leadUrl(reply.leadId),
    })

    const ok = await deliver(reply.organizationId, subject, text)
    if (ok) await prisma.inboundReply.update({ where: { id: replyId }, data: { notifiedAt: new Date() } })
    return ok
  } catch (err) {
    console.error(`[notify] reply ${replyId}: failed`, err)
    return false
  }
}

export async function notifyUnmatchedReply(unmatchedId: string): Promise<boolean> {
  try {
    const reply = await prisma.unmatchedReply.findUnique({
      where: { id: unmatchedId },
      include: { mailbox: { select: { email: true } } },
    })
    if (!reply || reply.notifiedAt) return false

    const { subject, text } = buildReplyNotification({
      classification: 'UNMATCHED',
      confidence: null,
      leadName: reply.fromEmail,
      leadEmail: reply.fromEmail,
      company: null,
      title: null,
      campaignName: null,
      mailboxEmail: reply.mailbox.email,
      replyText: `Subject: ${reply.subject}\n\n${reply.bodyPreview}`,
      leadUrl: null,
    })

    const ok = await deliver(reply.organizationId, subject, text)
    if (ok) await prisma.unmatchedReply.update({ where: { id: unmatchedId }, data: { notifiedAt: new Date() } })
    return ok
  } catch (err) {
    console.error(`[notify] unmatched ${unmatchedId}: failed`, err)
    return false
  }
}

export async function sendOrgAlert(organizationId: string, subject: string, text: string): Promise<boolean> {
  try {
    return await deliver(organizationId, `[OutboundOS] ${subject}`, text)
  } catch (err) {
    console.error(`[notify] org ${organizationId}: alert failed`, err)
    return false
  }
}
