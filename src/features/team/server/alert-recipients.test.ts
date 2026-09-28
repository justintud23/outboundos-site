import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    lead: { findFirst: vi.fn() },
    mailbox: { findFirst: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { resolveAlertRecipients } from './alert-recipients'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  organization: { findUnique: Fn }
  lead: { findFirst: Fn }
  mailbox: { findFirst: Fn }
}

beforeEach(() => {
  vi.resetAllMocks()
  p.organization.findUnique.mockResolvedValue({ escalationEmail: 'org@work.com', copyAdminOnReplies: true })
  p.lead.findFirst.mockResolvedValue(null)
  p.mailbox.findFirst.mockResolvedValue(null)
})

describe('resolveAlertRecipients', () => {
  it('lead owner wins: to is the lead owner escalationEmail', async () => {
    p.lead.findFirst.mockResolvedValue({ owner: { escalationEmail: 'rep-esc@work.com', email: 'rep@work.com' } })
    const { to } = await resolveAlertRecipients('org-1', { leadId: 'lead-1' })
    expect(to).toBe('rep-esc@work.com')
  })

  it('falls back to the lead owner email when escalationEmail is unset', async () => {
    p.lead.findFirst.mockResolvedValue({ owner: { escalationEmail: null, email: 'rep@work.com' } })
    const { to } = await resolveAlertRecipients('org-1', { leadId: 'lead-1' })
    expect(to).toBe('rep@work.com')
  })

  it('falls back to the mailbox owner when there is no lead owner', async () => {
    p.mailbox.findFirst.mockResolvedValue({ owner: { escalationEmail: 'mbx-esc@work.com', email: null } })
    const { to } = await resolveAlertRecipients('org-1', { leadId: 'lead-1', mailboxId: 'mbx-1' })
    expect(to).toBe('mbx-esc@work.com')
  })

  it('falls back to the org escalationEmail when neither lead nor mailbox has an owner', async () => {
    const { to } = await resolveAlertRecipients('org-1', { leadId: 'lead-1', mailboxId: 'mbx-1' })
    expect(to).toBe('org@work.com')
  })

  it('falls back to the org and never throws when the lead owner has no address at all (Review Focus #3)', async () => {
    p.lead.findFirst.mockResolvedValue({ owner: { escalationEmail: null, email: null } })
    p.mailbox.findFirst.mockResolvedValue(null)
    await expect(resolveAlertRecipients('org-1', { leadId: 'lead-1', mailboxId: 'mbx-1' })).resolves.toEqual({
      to: 'org@work.com',
      cc: null,
    })
  })

  it('cc is the org address when copyAdminOnReplies is on and it differs from to', async () => {
    p.lead.findFirst.mockResolvedValue({ owner: { escalationEmail: 'rep@work.com', email: null } })
    const { cc } = await resolveAlertRecipients('org-1', { leadId: 'lead-1' })
    expect(cc).toBe('org@work.com')
  })

  it('cc is null when the addresses match case-insensitively', async () => {
    p.lead.findFirst.mockResolvedValue({ owner: { escalationEmail: 'Org@Work.com', email: null } })
    const { cc } = await resolveAlertRecipients('org-1', { leadId: 'lead-1' })
    expect(cc).toBeNull()
  })

  it('cc is null when copyAdminOnReplies is off', async () => {
    p.organization.findUnique.mockResolvedValue({ escalationEmail: 'org@work.com', copyAdminOnReplies: false })
    p.lead.findFirst.mockResolvedValue({ owner: { escalationEmail: 'rep@work.com', email: null } })
    const { cc } = await resolveAlertRecipients('org-1', { leadId: 'lead-1' })
    expect(cc).toBeNull()
  })

  it('with no refs, resolves to the org address and no cc (system alert, Review Focus #4)', async () => {
    const out = await resolveAlertRecipients('org-1')
    expect(out).toEqual({ to: 'org@work.com', cc: null })
  })

  it('scopes the lead and mailbox lookups to the org', async () => {
    await resolveAlertRecipients('org-1', { leadId: 'lead-1', mailboxId: 'mbx-1' })
    expect(p.lead.findFirst).toHaveBeenCalledWith({
      where: { id: 'lead-1', organizationId: 'org-1' },
      select: { owner: { select: { escalationEmail: true, email: true } } },
    })
    expect(p.mailbox.findFirst).toHaveBeenCalledWith({
      where: { id: 'mbx-1', organizationId: 'org-1' },
      select: { owner: { select: { escalationEmail: true, email: true } } },
    })
  })
})
