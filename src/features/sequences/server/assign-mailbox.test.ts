import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    mailbox: { findMany: vi.fn(), count: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn(), findUnique: vi.fn() },
    domainHealth: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { assignEnrollmentMailbox } from './assign-mailbox'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  organization: { findUnique: Fn }
  mailbox: { findMany: Fn; count: Fn }
  sequenceEnrollment: { updateMany: Fn; findUnique: Fn }
  domainHealth: { findMany: Fn }
}
beforeEach(() => {
  vi.resetAllMocks()
  p.organization.findUnique.mockResolvedValue({ msTenantId: null })
  p.domainHealth.findMany.mockResolvedValue([])
  // No campaign owner by default (unowned) → shared mailboxes, unchanged behavior.
  p.sequenceEnrollment.findUnique.mockResolvedValue({ sequence: { campaign: { ownerId: null } } })
  p.mailbox.count.mockResolvedValue(0)
})

describe('assignEnrollmentMailbox', () => {
  it('picks the usable mailbox with the fewest ACTIVE enrollments and sets it only if unset', async () => {
    p.mailbox.findMany.mockResolvedValue([
      { id: 'mb-a', email: 'a@company.com', _count: { enrollments: 5 } },
      { id: 'mb-b', email: 'b@company.com', _count: { enrollments: 2 } },
    ])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-b')
    expect(p.mailbox.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', isActive: true, autoPaused: false, ownerId: null })
    expect(p.sequenceEnrollment.updateMany).toHaveBeenCalledWith({ where: { id: 'enr-1', mailboxId: null }, data: { mailboxId: 'mb-b' } })
  })
  it('returns the already-assigned mailbox if another worker won the race', async () => {
    p.mailbox.findMany.mockResolvedValue([{ id: 'mb-a', email: 'a@company.com', _count: { enrollments: 0 } }])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 0 })
    // First findUnique call is the campaign-owner lookup, second is the race re-check.
    p.sequenceEnrollment.findUnique
      .mockResolvedValueOnce({ sequence: { campaign: { ownerId: null } } })
      .mockResolvedValueOnce({ mailboxId: 'mb-z' })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-z')
  })
  it('returns null when no mailbox is usable', async () => {
    p.mailbox.findMany.mockResolvedValue([])
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBeNull()
  })
  it('only assigns Microsoft 365 mailboxes when the org has a tenant (I3)', async () => {
    p.organization.findUnique.mockResolvedValue({ msTenantId: 'tenant-1' })
    p.mailbox.findMany.mockResolvedValue([{ id: 'mb-g', email: 'g@company.com', _count: { enrollments: 0 } }])
    p.domainHealth.findMany.mockResolvedValue([{ domain: 'company.com', status: 'HEALTHY', registeredAt: null }])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-g')
    expect(p.mailbox.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1', isActive: true, autoPaused: false, provider: 'MICROSOFT_GRAPH', ownerId: null,
    })
  })

  it('Review Focus #1: in a Microsoft 365 org, skips mailboxes on unusable domains', async () => {
    p.organization.findUnique.mockResolvedValue({ msTenantId: 't' })
    p.mailbox.findMany.mockResolvedValue([
      { id: 'mb-bad', email: 'a@bad.com', _count: { enrollments: 0 } },
      { id: 'mb-ok', email: 'b@ok.com', _count: { enrollments: 9 } },
    ])
    p.domainHealth.findMany.mockResolvedValue([
      { domain: 'bad.com', status: 'FAILING', registeredAt: null },
      { domain: 'ok.com', status: 'WARNING', registeredAt: null },
    ])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-ok')
  })

  it('returns null when every mailbox is on an unusable domain', async () => {
    p.organization.findUnique.mockResolvedValue({ msTenantId: 't' })
    p.mailbox.findMany.mockResolvedValue([{ id: 'mb-bad', email: 'a@bad.com', _count: { enrollments: 0 } }])
    p.domainHealth.findMany.mockResolvedValue([])
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBeNull()
  })

  // ─── Task 6: mailbox choice by owner ───────────────────────────────────────

  it('uses the campaign owner\'s mailboxes when the owner has any', async () => {
    p.sequenceEnrollment.findUnique.mockResolvedValue({ sequence: { campaign: { ownerId: 'm-rep' } } })
    p.mailbox.count.mockResolvedValue(1)
    p.mailbox.findMany.mockResolvedValue([{ id: 'mb-rep', email: 'rep@company.com', _count: { enrollments: 0 } }])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-rep')
    expect(p.sequenceEnrollment.findUnique).toHaveBeenCalledWith({
      where: { id: 'enr-1' },
      select: { sequence: { select: { campaign: { select: { ownerId: true } } } } },
    })
    expect(p.mailbox.count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', ownerId: 'm-rep' } })
    expect(p.mailbox.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1', isActive: true, autoPaused: false, ownerId: 'm-rep',
    })
  })

  it('Review Focus #2: owner has mailboxes but all are paused/inactive/on failing domains → defers (null), never falls back to a shared or another rep\'s mailbox', async () => {
    p.sequenceEnrollment.findUnique.mockResolvedValue({ sequence: { campaign: { ownerId: 'm-rep' } } })
    // The owner does own mailboxes — but none satisfy isActive/autoPaused (or,
    // for MS orgs, domain health), so the DB query for THIS owner returns none.
    p.mailbox.count.mockResolvedValue(2)
    p.mailbox.findMany.mockResolvedValue([])
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBeNull()
    expect(p.mailbox.findMany.mock.calls[0][0].where).toMatchObject({ ownerId: 'm-rep' })
    expect(p.sequenceEnrollment.updateMany).not.toHaveBeenCalled()
  })

  it('Review Focus #4: unowned campaign + every mailbox unowned → behaves exactly as before (shared pool)', async () => {
    p.sequenceEnrollment.findUnique.mockResolvedValue({ sequence: { campaign: { ownerId: null } } })
    p.mailbox.findMany.mockResolvedValue([
      { id: 'mb-a', email: 'a@company.com', _count: { enrollments: 5 } },
      { id: 'mb-b', email: 'b@company.com', _count: { enrollments: 2 } },
    ])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-b')
    // No owner → mailboxOwnerFilter short-circuits before touching mailbox.count.
    expect(p.mailbox.count).not.toHaveBeenCalled()
    expect(p.mailbox.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1', isActive: true, autoPaused: false, ownerId: null,
    })
  })
})
