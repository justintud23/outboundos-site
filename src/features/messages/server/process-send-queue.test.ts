import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboundMessage: { updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
    organization: { findMany: vi.fn(), updateMany: vi.fn() },
    mailbox: { findMany: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    domainHealth: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/email', () => ({ getEmailProvider: vi.fn() }))
vi.mock('@/lib/email/graph/mail', () => ({ getMessageState: vi.fn(), sendDraftMessage: vi.fn() }))
vi.mock('@/features/mailboxes/server/mailbox-slots', () => ({
  startOfDay: (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
  reserveMailboxSlot: vi.fn(),
  releaseMailboxSlot: vi.fn(),
}))
vi.mock('@/features/sequences/server/check-enrollment-stop', () => ({ checkEnrollmentStop: vi.fn() }))
vi.mock('@/features/leads/server/transition-lead-status', () => ({ transitionLeadStatus: vi.fn() }))
vi.mock('@/features/replies/server/notify', () => ({ sendOrgAlert: vi.fn() }))
vi.mock('@/lib/email/unsubscribe-token', () => ({ signUnsubscribeToken: () => 'tok' }))

import { prisma } from '@/lib/db/prisma'
import { getEmailProvider } from '@/lib/email'
import { getMessageState, sendDraftMessage } from '@/lib/email/graph/mail'
import { reserveMailboxSlot, releaseMailboxSlot } from '@/features/mailboxes/server/mailbox-slots'
import { checkEnrollmentStop } from '@/features/sequences/server/check-enrollment-stop'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { GraphAuthError, GraphThrottledError } from '@/lib/email/graph/client'
import { processSendQueue } from './process-send-queue'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  outboundMessage: { updateMany: Fn; findMany: Fn; findFirst: Fn; update: Fn; findUnique: Fn; count: Fn }
  organization: { findMany: Fn; updateMany: Fn }
  mailbox: { findMany: Fn; update: Fn }
  auditLog: { create: Fn }
  domainHealth: { findMany: Fn }
}
const sendEmail = vi.fn()
const NOW = new Date('2026-09-23T14:00:00Z') // Wed 10:00 EDT — inside the window

const org = {
  id: 'org-1', msTenantId: 'tenant-1', timezone: 'America/New_York',
  businessHoursStart: 8, businessHoursEnd: 17, sendDays: [1, 2, 3, 4, 5], sendingPaused: false,
}
const mailbox = {
  id: 'mb-1', organizationId: 'org-1', email: 'mike@getacmesnow.com', displayName: 'Mike',
  dailyLimit: 30, warmupEnabled: false, warmupStartedAt: new Date('2026-01-01'), nextSendAt: null,
}
const queued = (o: Record<string, unknown> = {}) => ({
  id: 'msg-1', organizationId: 'org-1', leadId: 'lead-1', mailboxId: 'mb-1', status: 'QUEUED', processing: false,
  subject: 'Snow plan', body: 'Hello', graphMessageId: null, sendAttempts: 0, draftId: 'd1',
  lead: { id: 'lead-1', email: 'jane@acmepm.com', status: 'CONTACTED' },
  draft: { sequenceEnrollmentId: 'enr-1', sequenceEnrollment: { id: 'enr-1', status: 'ACTIVE', startedAt: new Date('2026-09-01') } },
  ...o,
})

beforeEach(() => {
  vi.resetAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
  ;(getEmailProvider as Fn).mockReturnValue({ sendEmail })
  sendEmail.mockResolvedValue({ sgMessageId: null, providerMessageId: 'g1', conversationId: 'conv-1' })
  p.outboundMessage.updateMany.mockResolvedValue({ count: 1 }) // stale-lock recovery + claim
  p.organization.findMany.mockResolvedValue([org])
  p.mailbox.findMany.mockResolvedValue([mailbox])
  p.outboundMessage.findFirst.mockResolvedValue({ id: 'msg-1' })
  p.outboundMessage.findUnique.mockResolvedValue(queued())
  p.outboundMessage.findMany.mockResolvedValue([]) // no prior thread
  p.outboundMessage.count.mockResolvedValue(0) // no unsent earlier step
  ;(reserveMailboxSlot as Fn).mockResolvedValue(true)
  ;(checkEnrollmentStop as Fn).mockResolvedValue({ shouldStop: false })
  p.domainHealth.findMany.mockResolvedValue([{ domain: 'getacmesnow.com', status: 'HEALTHY', registeredAt: new Date('2025-01-01') }])
})

describe('processSendQueue', () => {
  it('sends one due message per ready mailbox, finalizes SENT and paces the mailbox', async () => {
    const res = await processSendQueue(NOW)
    expect(res.sent).toBe(1)
    expect(getEmailProvider).toHaveBeenCalledWith({ msTenantId: 'tenant-1' })
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'jane@acmepm.com', fromEmail: 'mike@getacmesnow.com', subject: 'Snow plan' })
    expect(p.outboundMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg-1' },
      data: expect.objectContaining({ status: 'SENT', graphMessageId: 'g1', conversationId: 'conv-1', processing: false }),
    }))
    const paced = p.mailbox.update.mock.calls[0][0]
    expect(paced.where).toEqual({ id: 'mb-1' })
    // 9h / 30 = 18 min, ±30% → between 12.6 and 23.4 minutes after NOW
    const delta = paced.data.nextSendAt.getTime() - NOW.getTime()
    expect(delta).toBeGreaterThanOrEqual(12.6 * 60_000)
    expect(delta).toBeLessThanOrEqual(23.4 * 60_000)
  })

  it('does nothing outside business hours', async () => {
    const res = await processSendQueue(new Date('2026-09-26T15:00:00Z')) // Saturday
    expect(res.sent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('cancels a queued follow-up when the lead replied since queueing (Review Focus #1)', async () => {
    ;(checkEnrollmentStop as Fn).mockResolvedValue({ shouldStop: true, reason: 'reply_received' })
    const res = await processSendQueue(NOW)
    expect(res.cancelled).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(p.outboundMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'CANCELLED', processing: false, lastError: 'reply_received' },
    })
  })

  it('crash recovery: graphMessageId already in Sent Items → mark SENT without resending (Review Focus #3)', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(queued({ graphMessageId: 'g-prev' }))
    ;(getMessageState as Fn).mockResolvedValue({ state: 'SENT', conversationId: 'conv-9' })
    const res = await processSendQueue(NOW)
    expect(res.reconciled).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendDraftMessage).not.toHaveBeenCalled()
    expect(p.outboundMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SENT', conversationId: 'conv-9' }),
    }))
  })

  it('crash recovery: graphMessageId still a draft → sends that draft, no new message', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(queued({ graphMessageId: 'g-prev' }))
    ;(getMessageState as Fn).mockResolvedValue({ state: 'DRAFT', conversationId: 'conv-9' })
    await processSendQueue(NOW)
    expect(sendDraftMessage).toHaveBeenCalledWith('tenant-1', 'mike@getacmesnow.com', 'g-prev')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('mailbox at capacity: leaves the message queued and pushes the mailbox out', async () => {
    ;(reserveMailboxSlot as Fn).mockResolvedValue(false)
    const res = await processSendQueue(NOW)
    expect(res.deferred).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(p.outboundMessage.update).toHaveBeenCalledWith({ where: { id: 'msg-1' }, data: { processing: false } })
  })

  it('throttled: releases the slot and reschedules by Retry-After', async () => {
    sendEmail.mockRejectedValue(new GraphThrottledError('slow', 429, 120))
    const res = await processSendQueue(NOW)
    expect(res.deferred).toBe(1)
    expect(releaseMailboxSlot).toHaveBeenCalledWith('mb-1')
    const upd = p.outboundMessage.update.mock.calls.at(-1)![0]
    expect(upd.data.scheduledFor.getTime()).toBe(NOW.getTime() + 120_000)
    expect(upd.data.processing).toBe(false)
  })

  it('auth failure: pauses the org and alerts once', async () => {
    sendEmail.mockRejectedValue(new GraphAuthError('denied', 403))
    p.organization.updateMany.mockResolvedValue({ count: 1 })
    await processSendQueue(NOW)
    expect(p.organization.updateMany).toHaveBeenCalledWith({
      where: { id: 'org-1', sendingPaused: false },
      data: { sendingPaused: true, pausedReason: expect.stringContaining('Microsoft 365') },
    })
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
  })

  it('third generic failure marks the message FAILED', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(queued({ sendAttempts: 2 }))
    sendEmail.mockRejectedValue(new Error('500 from Graph'))
    const res = await processSendQueue(NOW)
    expect(res.failed).toBe(1)
    expect(p.outboundMessage.update.mock.calls.at(-1)![0].data).toMatchObject({ status: 'FAILED', sendAttempts: 3 })
  })

  it('threads a follow-up onto the most recent prior Graph message with "Re: <root>"', async () => {
    p.outboundMessage.findMany.mockResolvedValue([
      { subject: 'Snow plan for Acme', graphMessageId: 'g-root' },
    ])
    p.outboundMessage.findUnique.mockResolvedValue(queued({ subject: 'Following up' }))
    await processSendQueue(NOW)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ subject: 'Re: Snow plan for Acme', replyToProviderMessageId: 'g-root' })
  })

  // ─── Fix round 1 ────────────────────────────────────────────

  it('only queries orgs with a connected Microsoft 365 tenant (Important #2)', async () => {
    await processSendQueue(NOW)
    expect(p.organization.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ msTenantId: { not: null } }) }),
    )
  })

  it('getMessageState throwing GraphAuthError pauses the org and alerts, without the tick throwing (Important #1)', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(queued({ graphMessageId: 'g-prev' }))
    ;(getMessageState as Fn).mockRejectedValue(new GraphAuthError('denied', 403))
    p.organization.updateMany.mockResolvedValue({ count: 1 })
    const res = await processSendQueue(NOW)
    expect(res.failed).toBe(1)
    expect(p.organization.updateMany).toHaveBeenCalledWith({
      where: { id: 'org-1', sendingPaused: false },
      data: { sendingPaused: true, pausedReason: expect.stringContaining('Microsoft 365') },
    })
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('threading lookup failing after slot reservation releases the slot and unclaims the message (Important #1)', async () => {
    p.outboundMessage.findMany.mockRejectedValue(new Error('db timeout'))
    const res = await processSendQueue(NOW)
    expect(res.deferred).toBe(1)
    expect(releaseMailboxSlot).toHaveBeenCalledWith('mb-1')
    expect(p.outboundMessage.update).toHaveBeenCalledWith({ where: { id: 'msg-1' }, data: { processing: false } })
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('finalizeSent failing twice after a successful send never releases the claim back to QUEUED (Important #2)', async () => {
    p.outboundMessage.update.mockRejectedValue(new Error('db down'))
    const res = await processSendQueue(NOW)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    // The SENT update was attempted twice (one retry) ...
    const sentAttempts = p.outboundMessage.update.mock.calls.filter((c) => c[0].data?.status === 'SENT')
    expect(sentAttempts.length).toBe(2)
    // ... but the claim was never reverted to available (no bare processing:false reset).
    expect(p.outboundMessage.update).not.toHaveBeenCalledWith({ where: { id: 'msg-1' }, data: { processing: false } })
    expect(releaseMailboxSlot).not.toHaveBeenCalled()
    expect(res.sent).toBe(1)
  })

  it('crash recovery: graphMessageId missing from the mailbox marks FAILED and never resends (Promoted minor #3)', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(queued({ graphMessageId: 'g-prev' }))
    ;(getMessageState as Fn).mockResolvedValue({ state: 'MISSING', conversationId: null })
    const res = await processSendQueue(NOW)
    expect(res.failed).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendDraftMessage).not.toHaveBeenCalled()
    expect(p.outboundMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'FAILED', processing: false, lastError: 'Graph message missing from mailbox; not resent automatically' },
    })
  })

  // ─── Final review fixes ─────────────────────────────────────

  const followUp = (o: Record<string, unknown> = {}) =>
    queued({
      draft: {
        sequenceEnrollmentId: 'enr-1',
        sequenceEnrollment: { id: 'enr-1', status: 'ACTIVE', startedAt: new Date('2026-09-01') },
        sequenceStep: { stepNumber: 2 },
      },
      ...o,
    })

  it('defers a follow-up whose earlier step is not SENT yet: stays QUEUED, +1h, nothing sent (I1)', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(followUp())
    p.outboundMessage.count.mockResolvedValue(1)
    const res = await processSendQueue(NOW)
    expect(res.deferred).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(reserveMailboxSlot).not.toHaveBeenCalled()
    expect(p.outboundMessage.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        id: { not: 'msg-1' },
        status: { in: ['QUEUED', 'FAILED'] },
        draft: { sequenceEnrollmentId: 'enr-1', sequenceStep: { stepNumber: { lt: 2 } } },
      },
    })
    const upd = p.outboundMessage.update.mock.calls.at(-1)![0]
    expect(upd.where).toEqual({ id: 'msg-1' })
    expect(upd.data).toEqual({ processing: false, processingStartedAt: null, scheduledFor: new Date(NOW.getTime() + 60 * 60 * 1000) })
    expect(upd.data.status).toBeUndefined()
  })

  it('sends a follow-up once every earlier step is SENT', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(followUp())
    p.outboundMessage.count.mockResolvedValue(0)
    const res = await processSendQueue(NOW)
    expect(res.sent).toBe(1)
  })

  it('holds messages of campaigns whose auto-send is off (only picks campaign-less or autoSend campaigns) (I6)', async () => {
    await processSendQueue(NOW)
    expect(p.outboundMessage.findFirst.mock.calls[0][0].where).toMatchObject({
      status: 'QUEUED',
      OR: [{ campaignId: null }, { campaign: { is: { autoSend: true } } }],
    })
  })

  it('a held (autoSend=false) message is not sent: nothing selectable for the mailbox', async () => {
    p.outboundMessage.findFirst.mockResolvedValue(null) // the autoSend filter excluded it
    const res = await processSendQueue(NOW)
    expect(res).toEqual({ sent: 0, cancelled: 0, deferred: 0, failed: 0, reconciled: 0 })
    expect(sendEmail).not.toHaveBeenCalled()
    expect(p.outboundMessage.update).not.toHaveBeenCalled()
  })

  it('only sends from Microsoft 365 mailboxes (I3)', async () => {
    await processSendQueue(NOW)
    expect(p.mailbox.findMany.mock.calls[0][0].where).toMatchObject({ organizationId: 'org-1', provider: 'MICROSOFT_GRAPH' })
  })

  it('CAN-SPAM: only orgs with a postal address are processed, and the footer gets it', async () => {
    p.organization.findMany.mockResolvedValue([{ ...org, businessName: 'Acme Snow', postalAddress: '1 Main St, Buffalo, NY', allowCanadianRecipients: false }])
    await processSendQueue(NOW)
    const where = p.organization.findMany.mock.calls[0][0].where
    expect(where.postalAddress).toEqual({ not: null })
    expect(where.NOT).toEqual({ postalAddress: '' })
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ sender: { businessName: 'Acme Snow', postalAddress: '1 Main St, Buffalo, NY' } })
  })

  it('CASL: a queued email to a Canadian lead is cancelled, never sent', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(queued({ lead: { id: 'lead-1', email: 'jane@acmepm.ca', status: 'CONTACTED' } }))
    const res = await processSendQueue(NOW)
    expect(res.cancelled).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(p.outboundMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'CANCELLED', processing: false, lastError: 'excluded_canada: email ends in .ca' },
    })
  })

  it('Review Focus #1: a mailbox on an UNVERIFIED or FAILING domain does not send; its message stays QUEUED', async () => {
    for (const status of ['UNVERIFIED', 'FAILING']) {
      vi.clearAllMocks()
      p.domainHealth.findMany.mockResolvedValue([{ domain: 'getacmesnow.com', status, registeredAt: new Date('2025-01-01') }])
      const res = await processSendQueue(NOW)
      expect(res.sent).toBe(0)
      expect(sendEmail).not.toHaveBeenCalled()
      expect(p.outboundMessage.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }))
    }
  })

  it('Review Focus #1: a Graph mailbox whose domain has no row is treated as unverified', async () => {
    p.domainHealth.findMany.mockResolvedValue([])
    expect((await processSendQueue(NOW)).sent).toBe(0)
  })

  it('young domain: today’s limit is capped at 10 for the slot reservation', async () => {
    p.domainHealth.findMany.mockResolvedValue([{ domain: 'getacmesnow.com', status: 'HEALTHY', registeredAt: new Date(NOW.getTime() - 5 * 86_400_000) }])
    await processSendQueue(NOW)
    expect((reserveMailboxSlot as Fn).mock.calls[0][1]).toBe(10)
  })

  // ─── Fix round 1 ────────────────────────────────────────────

  it('Fix round 1 #2: a domain-health failure for one org does not abort the tick for other orgs', async () => {
    const org2 = { ...org, id: 'org-2' }
    const mailbox2 = { ...mailbox, id: 'mb-2', organizationId: 'org-2', email: 'sam@othercorp.com' }
    p.organization.findMany.mockResolvedValue([org, org2])
    p.mailbox.findMany.mockImplementation(async ({ where }: { where: { organizationId: string } }) =>
      where.organizationId === 'org-1' ? [mailbox] : [mailbox2],
    )
    p.domainHealth.findMany
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockResolvedValueOnce([{ domain: 'othercorp.com', status: 'HEALTHY', registeredAt: new Date('2025-01-01') }])
    const res = await processSendQueue(NOW)
    expect(res.sent).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ fromEmail: 'sam@othercorp.com' })
  })

  it('Fix round 1 #3a: a mixed org — the healthy mailbox sends, the blocked one is never claimed and never consumes the tick budget', async () => {
    const mailboxBad = { ...mailbox, id: 'mb-bad', email: 'bad@getacmesnow.com' }
    const mailboxGood = { ...mailbox, id: 'mb-good', email: 'ok@healthydomain.com' }
    p.mailbox.findMany.mockResolvedValue([mailboxBad, mailboxGood])
    p.domainHealth.findMany.mockResolvedValue([
      { domain: 'getacmesnow.com', status: 'FAILING', registeredAt: new Date('2025-01-01') },
      { domain: 'healthydomain.com', status: 'HEALTHY', registeredAt: new Date('2025-01-01') },
    ])
    p.outboundMessage.findFirst.mockImplementation(async ({ where }: { where: { mailboxId: string } }) =>
      where.mailboxId === 'mb-good' ? { id: 'msg-1' } : null,
    )
    const res = await processSendQueue(NOW)
    expect(res.sent).toBe(1)
    expect(sendEmail).toHaveBeenCalledTimes(1)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ fromEmail: 'ok@healthydomain.com' })
    // The blocked mailbox is skipped before its queue is ever queried — no
    // message is claimed for it, and no budget slot is spent on it.
    expect(p.outboundMessage.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ mailboxId: 'mb-bad' }) }),
    )
    expect(p.outboundMessage.findFirst).toHaveBeenCalledTimes(1)
  })
})
