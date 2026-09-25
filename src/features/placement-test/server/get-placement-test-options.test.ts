import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequence: { findMany: vi.fn() },
    mailbox: { findMany: vi.fn() },
    sequenceEnrollment: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getPlacementTestOptions } from './get-placement-test-options'

type Fn = ReturnType<typeof vi.fn>
const mockPrisma = prisma as unknown as {
  sequence: { findMany: Fn }
  mailbox: { findMany: Fn }
  sequenceEnrollment: { findMany: Fn }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.sequence.findMany.mockResolvedValue([{ id: 'seq-1', name: 'Intro' }])
  mockPrisma.mailbox.findMany.mockResolvedValue([{ id: 'mb-1', email: 'rep@company.com' }])
  mockPrisma.sequenceEnrollment.findMany.mockResolvedValue([
    { lead: { id: 'lead-1', firstName: 'Bob', lastName: 'Builder', email: 'bob@acme.com' } },
    { lead: { id: 'lead-2', firstName: null, lastName: null, email: 'noname@acme.com' } },
    { lead: { id: 'lead-1', firstName: 'Bob', lastName: 'Builder', email: 'bob@acme.com' } }, // dup enrollment, same lead
  ])
})

describe('getPlacementTestOptions', () => {
  it('loads sequences, active Graph mailboxes, and de-duped enrolled leads', async () => {
    const result = await getPlacementTestOptions({ organizationId: 'org-1', campaignId: 'camp-1', hasMsTenant: true })
    expect(result.sequences).toEqual([{ id: 'seq-1', name: 'Intro' }])
    expect(result.mailboxes).toEqual([{ id: 'mb-1', email: 'rep@company.com' }])
    expect(result.leads).toEqual([
      { id: 'lead-1', label: 'Bob Builder' },
      { id: 'lead-2', label: 'noname@acme.com' },
    ])
    expect(mockPrisma.mailbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', provider: 'MICROSOFT_GRAPH', isActive: true, autoPaused: false } }),
    )
  })

  it('skips the mailbox query and returns no mailboxes when the org has no Microsoft tenant', async () => {
    const result = await getPlacementTestOptions({ organizationId: 'org-1', campaignId: 'camp-1', hasMsTenant: false })
    expect(result.mailboxes).toEqual([])
    expect(mockPrisma.mailbox.findMany).not.toHaveBeenCalled()
  })
})
