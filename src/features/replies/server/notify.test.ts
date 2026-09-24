import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    inboundReply: { findUnique: vi.fn(), update: vi.fn() },
    unmatchedReply: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/email/graph/mail', () => ({ sendMailAsText: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { sendMailAsText } from '@/lib/email/graph/mail'
import { buildReplyNotification, notifyReply, notifyUnmatchedReply, sendOrgAlert } from './notify'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  organization: { findUnique: Fn }
  inboundReply: { findUnique: Fn; update: Fn }
  unmatchedReply: { findUnique: Fn; update: Fn }
}
const send = sendMailAsText as Fn

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MS_NOTIFY_MAILBOX = 'alerts@getacmesnow.com'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
  p.organization.findUnique.mockResolvedValue({ escalationEmail: 'justin@work.com', msTenantId: 'tenant-1' })
})

const reply = {
  id: 'r1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  notifiedAt: null,
  classification: 'POSITIVE',
  classificationConfidence: 0.92,
  rawBody: 'Yes — can you quote our 3 lots?\nThanks',
  lead: { firstName: 'Jane', lastName: 'Doe', email: 'jane@acmepm.com', company: 'Acme PM', title: 'Facilities Manager' },
  mailbox: { email: 'mike@getacmesnow.com' },
  outboundMessage: { campaign: { name: 'Buffalo HOAs' } },
}

describe('buildReplyNotification', () => {
  it('formats subject and body', () => {
    const n = buildReplyNotification({
      classification: 'POSITIVE',
      confidence: 0.92,
      leadName: 'Jane Doe',
      leadEmail: 'jane@acmepm.com',
      company: 'Acme PM',
      title: 'Facilities Manager',
      campaignName: 'Buffalo HOAs',
      mailboxEmail: 'mike@getacmesnow.com',
      replyText: 'Line 1\nLine 2',
      leadUrl: 'https://app.test/leads/lead-1',
    })
    expect(n.subject).toBe('[Reply – POSITIVE] Jane Doe @ Acme PM')
    expect(n.text).toContain('Classification: POSITIVE (92% confidence)')
    expect(n.text).toContain('Answer from this mailbox in Outlook: mike@getacmesnow.com')
    expect(n.text).toContain('> Line 1\n> Line 2')
  })
  it('truncates very long replies', () => {
    const n = buildReplyNotification({
      classification: 'NEUTRAL', confidence: null, leadName: 'X', leadEmail: 'x@y.com', company: null, title: null,
      campaignName: null, mailboxEmail: null, replyText: 'a'.repeat(5000), leadUrl: null,
    })
    expect(n.text.length).toBeLessThan(2300)
    expect(n.text).toContain('…')
  })
})

describe('notifyReply', () => {
  it('sends from MS_NOTIFY_MAILBOX to escalationEmail and stamps notifiedAt', async () => {
    p.inboundReply.findUnique.mockResolvedValue(reply)
    expect(await notifyReply('r1')).toBe(true)
    expect(send).toHaveBeenCalledWith('tenant-1', 'alerts@getacmesnow.com', 'justin@work.com', expect.stringContaining('Jane Doe'), expect.stringContaining('https://app.test/leads/lead-1'))
    expect(p.inboundReply.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { notifiedAt: expect.any(Date) } })
  })
  it('skips already-notified replies', async () => {
    p.inboundReply.findUnique.mockResolvedValue({ ...reply, notifiedAt: new Date() })
    expect(await notifyReply('r1')).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
  it('returns false without throwing when escalationEmail is missing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    p.inboundReply.findUnique.mockResolvedValue(reply)
    p.organization.findUnique.mockResolvedValue({ escalationEmail: null, msTenantId: 'tenant-1' })
    expect(await notifyReply('r1')).toBe(false)
  })
  it('returns false and leaves notifiedAt null when Graph fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    p.inboundReply.findUnique.mockResolvedValue(reply)
    send.mockRejectedValueOnce(new Error('boom'))
    expect(await notifyReply('r1')).toBe(false)
    expect(p.inboundReply.update).not.toHaveBeenCalled()
  })
  it('returns false when prisma.inboundReply.findUnique rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    p.inboundReply.findUnique.mockRejectedValueOnce(new Error('db error'))
    expect(await notifyReply('r1')).toBe(false)
  })
  it('returns false when prisma.inboundReply.update rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    p.inboundReply.findUnique.mockResolvedValue(reply)
    p.inboundReply.update.mockRejectedValueOnce(new Error('update failed'))
    expect(await notifyReply('r1')).toBe(false)
  })
})

describe('notifyUnmatchedReply', () => {
  it('labels the notification UNMATCHED', async () => {
    p.unmatchedReply.findUnique.mockResolvedValue({
      id: 'u1', organizationId: 'org-1', notifiedAt: null, fromEmail: 'bob@acmepm.com', subject: 'Re: Snow plan',
      bodyPreview: 'Jane is out, I handle this.', mailbox: { email: 'mike@getacmesnow.com' },
    })
    expect(await notifyUnmatchedReply('u1')).toBe(true)
    expect(send.mock.calls[0][3]).toBe('[Reply – UNMATCHED] bob@acmepm.com')
  })
})

describe('sendOrgAlert', () => {
  it('prefixes the subject', async () => {
    expect(await sendOrgAlert('org-1', 'Sending paused', 'why')).toBe(true)
    expect(send.mock.calls[0][3]).toBe('[OutboundOS] Sending paused')
  })
  it('returns false when prisma.organization.findUnique rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    p.organization.findUnique.mockRejectedValueOnce(new Error('org lookup failed'))
    expect(await sendOrgAlert('org-1', 'Alert', 'text')).toBe(false)
  })
})
