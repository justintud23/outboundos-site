import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    mailbox: { findMany: vi.fn(), update: vi.fn() },
    outboundMessage: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    lead: { findFirst: vi.fn() },
    inboundReply: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    unmatchedReply: { upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    messageEvent: { create: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock('@/lib/email/graph/mail', () => ({ fetchFolderDelta: vi.fn() }))
vi.mock('@/features/replies/server/record-reply', () => ({ recordReply: vi.fn() }))
vi.mock('@/features/replies/server/notify', () => ({ notifyReply: vi.fn(), notifyUnmatchedReply: vi.fn() }))
vi.mock('@/features/messages/server/process-send-queue', () => ({ pauseOrgSending: vi.fn() }))
vi.mock('@/features/leads/server/transition-lead-status', () => ({ transitionLeadStatus: vi.fn() }))
vi.mock('@/features/mailboxes/server/evaluate-mailbox-breaker', () => ({ evaluateMailboxBreaker: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { fetchFolderDelta } from '@/lib/email/graph/mail'
import { recordReply } from '@/features/replies/server/record-reply'
import { notifyReply, notifyUnmatchedReply } from '@/features/replies/server/notify'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { evaluateMailboxBreaker } from '@/features/mailboxes/server/evaluate-mailbox-breaker'
import { pauseOrgSending } from '@/features/messages/server/process-send-queue'
import { GraphAuthError, GraphError } from '@/lib/email/graph/client'
import { monitorMailboxes } from './monitor-mailboxes'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as Record<string, Record<string, Fn>>
const delta = fetchFolderDelta as Fn
const NOW = new Date('2026-09-23T14:00:00Z')

const mb = {
  id: 'mb-1', organizationId: 'org-1', email: 'mike@getacmesnow.com',
  inboxDeltaLink: 'https://graph.microsoft.com/v1.0/inbox-d1', sentDeltaLink: 'https://graph.microsoft.com/v1.0/sent-d1',
  organization: { msTenantId: 'tenant-1', mailboxes: [{ email: 'mike@getacmesnow.com' }] },
}
const human = {
  id: 'gm-1', conversationId: 'conv-1', subject: 'Re: Snow plan', from: { emailAddress: { address: 'Jane@AcmePM.com' } },
  receivedDateTime: '2026-09-23T13:58:00Z', body: { contentType: 'text', content: 'Yes please quote us' }, internetMessageHeaders: [],
}

function inboxThenSent(inbox: unknown[], sent: unknown[] = []) {
  delta.mockImplementation(async (_t: string, _m: string, folder: string) =>
    folder === 'inbox'
      ? { messages: inbox, resumeLink: 'https://graph.microsoft.com/v1.0/inbox-d2' }
      : { messages: sent, resumeLink: 'https://graph.microsoft.com/v1.0/sent-d2' },
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MS_NOTIFY_MAILBOX = 'alerts@getacmesnow.com'
  p.mailbox.findMany.mockResolvedValue([mb])
  p.inboundReply.findUnique.mockResolvedValue(null)
  p.inboundReply.findMany.mockResolvedValue([])
  p.unmatchedReply.findMany.mockResolvedValue([])
  p.outboundMessage.findMany.mockResolvedValue([])
  ;(recordReply as Fn).mockResolvedValue({ id: 'r1', classification: 'POSITIVE' })
  ;(notifyReply as Fn).mockResolvedValue(true)
})

describe('monitorMailboxes', () => {
  it('human reply matched by conversation: records, stops enrollments, cancels queued mail, notifies, saves delta links', async () => {
    inboxThenSent([human])
    p.outboundMessage.findFirst.mockResolvedValue({ id: 'om-1', leadId: 'lead-1' })
    const res = await monitorMailboxes(NOW)
    expect(recordReply).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', leadId: 'lead-1', outboundMessageId: 'om-1', rawBody: 'Yes please quote us',
      mailboxId: 'mb-1', graphMessageId: 'gm-1', conversationId: 'conv-1', fromEmail: 'jane@acmepm.com',
    }))
    expect(p.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1', organizationId: 'org-1', status: 'ACTIVE' },
      data: { status: 'STOPPED', stoppedAt: expect.any(Date), stoppedReason: 'reply_received' },
    })
    expect(p.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1', organizationId: 'org-1', status: 'QUEUED', processing: false },
      data: { status: 'CANCELLED', lastError: 'reply_received' },
    })
    expect(notifyReply).toHaveBeenCalledWith('r1')
    expect(p.mailbox.update).toHaveBeenCalledWith({
      where: { id: 'mb-1' },
      data: { inboxDeltaLink: 'https://graph.microsoft.com/v1.0/inbox-d2', sentDeltaLink: 'https://graph.microsoft.com/v1.0/sent-d2', lastPolledAt: NOW },
    })
    expect(res.replies).toBe(1)
  })

  it('falls back to matching by sender email (case-insensitive)', async () => {
    inboxThenSent([{ ...human, conversationId: 'unknown' }])
    p.outboundMessage.findFirst.mockResolvedValue(null)
    p.lead.findFirst.mockResolvedValue({ id: 'lead-7' })
    await monitorMailboxes(NOW)
    expect(p.lead.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', email: { equals: 'jane@acmepm.com', mode: 'insensitive' } },
      select: { id: true },
    })
    expect((recordReply as Fn).mock.calls[0][0].leadId).toBe('lead-7')
  })

  it('same message seen twice → one reply, one notification (Review Focus #4)', async () => {
    inboxThenSent([human, human])
    p.outboundMessage.findFirst.mockResolvedValue({ id: 'om-1', leadId: 'lead-1' })
    p.inboundReply.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'r1' })
    await monitorMailboxes(NOW)
    expect(recordReply).toHaveBeenCalledTimes(1)
    expect(notifyReply).toHaveBeenCalledTimes(1)
  })

  it('a unique-constraint race on graphMessageId is treated as already processed', async () => {
    inboxThenSent([human])
    p.outboundMessage.findFirst.mockResolvedValue({ id: 'om-1', leadId: 'lead-1' })
    ;(recordReply as Fn).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7' }))
    await expect(monitorMailboxes(NOW)).resolves.toMatchObject({ replies: 0 })
    expect(notifyReply).not.toHaveBeenCalled()
  })

  it('unsubscribe request: recorded, no notification', async () => {
    inboxThenSent([human])
    p.outboundMessage.findFirst.mockResolvedValue({ id: 'om-1', leadId: 'lead-1' })
    ;(recordReply as Fn).mockResolvedValue({ id: 'r1', classification: 'UNSUBSCRIBE_REQUEST' })
    await monitorMailboxes(NOW)
    expect(notifyReply).not.toHaveBeenCalled()
  })

  it('unmatched human reply is stored and notified', async () => {
    inboxThenSent([{ ...human, from: { emailAddress: { address: 'bob@acmepm.com' } } }])
    p.outboundMessage.findFirst.mockResolvedValue(null)
    p.lead.findFirst.mockResolvedValue(null)
    p.unmatchedReply.upsert.mockResolvedValue({ id: 'u1', notifiedAt: null })
    const res = await monitorMailboxes(NOW)
    expect(p.unmatchedReply.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { graphMessageId: 'gm-1' } }))
    expect(notifyUnmatchedReply).toHaveBeenCalledWith('u1')
    expect(res.unmatched).toBe(1)
  })

  it('bounce: records BOUNCED event, bounces the lead, stops, and evaluates the breaker', async () => {
    inboxThenSent([{
      id: 'gm-2', conversationId: 'c2', subject: 'Undeliverable: Snow plan',
      from: { emailAddress: { address: 'postmaster@getacmesnow.com' } },
      body: { contentType: 'text', content: "Your message to bob@nowhere.example couldn't be delivered." },
    }])
    p.outboundMessage.findFirst.mockResolvedValue({ id: 'om-9', leadId: 'lead-9' })
    const res = await monitorMailboxes(NOW)
    expect(p.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-1', outboundMessageId: 'om-9', eventType: 'BOUNCED', sgEventId: 'graph:gm-2' }),
    })
    expect(transitionLeadStatus).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-9', newStatus: 'BOUNCED' }))
    expect(evaluateMailboxBreaker).toHaveBeenCalledWith('mb-1')
    expect(recordReply).not.toHaveBeenCalled()
    expect(res.bounces).toBe(1)
  })

  it('auto-reply: audit-logged only, sequence untouched', async () => {
    inboxThenSent([{ ...human, subject: 'Automatic reply: Snow plan' }])
    const res = await monitorMailboxes(NOW)
    expect(p.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'reply.auto_reply' }) })
    expect(recordReply).not.toHaveBeenCalled()
    expect(p.sequenceEnrollment.updateMany).not.toHaveBeenCalled()
    expect(res.autoReplies).toBe(1)
  })

  it('sent items: a human-written reply in a tracked conversation marks it handled', async () => {
    inboxThenSent([], [{ id: 'sent-1', conversationId: 'conv-1', sentDateTime: '2026-09-23T13:59:00Z' }])
    p.outboundMessage.findMany.mockResolvedValue([]) // sent-1 is not one of ours
    p.inboundReply.updateMany.mockResolvedValue({ count: 1 })
    p.unmatchedReply.updateMany.mockResolvedValue({ count: 0 })
    const res = await monitorMailboxes(NOW)
    expect(p.inboundReply.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', conversationId: 'conv-1', handledAt: null },
      data: { handledAt: new Date('2026-09-23T13:59:00Z') },
    })
    expect(res.handled).toBe(1)
  })

  it('sent items: our own auto-sent messages never mark anything handled', async () => {
    inboxThenSent([], [{ id: 'g1', conversationId: 'conv-1', sentDateTime: '2026-09-23T13:59:00Z' }])
    p.outboundMessage.findMany.mockResolvedValue([{ graphMessageId: 'g1' }])
    await monitorMailboxes(NOW)
    expect(p.inboundReply.updateMany).not.toHaveBeenCalled()
  })

  it('expired delta link (410): clears the stored link so the next tick restarts with a 24h lookback', async () => {
    delta.mockRejectedValue(new GraphError('gone', 410, 'SyncStateNotFound'))
    await monitorMailboxes(NOW)
    expect(p.mailbox.update).toHaveBeenCalledWith({ where: { id: 'mb-1' }, data: { inboxDeltaLink: null, sentDeltaLink: null } })
  })

  it('auth error pauses the org', async () => {
    delta.mockRejectedValue(new GraphAuthError('denied', 403))
    await monitorMailboxes(NOW)
    expect(pauseOrgSending).toHaveBeenCalledWith('org-1', expect.stringContaining('Microsoft 365'))
  })

  it('re-sweeps replies whose notification failed earlier', async () => {
    inboxThenSent([])
    p.inboundReply.findMany.mockResolvedValue([{ id: 'r-old' }])
    await monitorMailboxes(NOW)
    expect(notifyReply).toHaveBeenCalledWith('r-old')
  })
})
