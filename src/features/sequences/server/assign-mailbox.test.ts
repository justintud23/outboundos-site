import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    mailbox: { findMany: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn(), findUnique: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { assignEnrollmentMailbox } from './assign-mailbox'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  organization: { findUnique: Fn }
  mailbox: { findMany: Fn }
  sequenceEnrollment: { updateMany: Fn; findUnique: Fn }
}
beforeEach(() => {
  vi.resetAllMocks()
  p.organization.findUnique.mockResolvedValue({ msTenantId: null })
})

describe('assignEnrollmentMailbox', () => {
  it('picks the usable mailbox with the fewest ACTIVE enrollments and sets it only if unset', async () => {
    p.mailbox.findMany.mockResolvedValue([
      { id: 'mb-a', _count: { enrollments: 5 } },
      { id: 'mb-b', _count: { enrollments: 2 } },
    ])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-b')
    expect(p.mailbox.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', isActive: true, autoPaused: false })
    expect(p.sequenceEnrollment.updateMany).toHaveBeenCalledWith({ where: { id: 'enr-1', mailboxId: null }, data: { mailboxId: 'mb-b' } })
  })
  it('returns the already-assigned mailbox if another worker won the race', async () => {
    p.mailbox.findMany.mockResolvedValue([{ id: 'mb-a', _count: { enrollments: 0 } }])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 0 })
    p.sequenceEnrollment.findUnique.mockResolvedValue({ mailboxId: 'mb-z' })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-z')
  })
  it('returns null when no mailbox is usable', async () => {
    p.mailbox.findMany.mockResolvedValue([])
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBeNull()
  })
  it('only assigns Microsoft 365 mailboxes when the org has a tenant (I3)', async () => {
    p.organization.findUnique.mockResolvedValue({ msTenantId: 'tenant-1' })
    p.mailbox.findMany.mockResolvedValue([{ id: 'mb-g', _count: { enrollments: 0 } }])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-g')
    expect(p.mailbox.findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1', isActive: true, autoPaused: false, provider: 'MICROSOFT_GRAPH',
    })
  })
})
