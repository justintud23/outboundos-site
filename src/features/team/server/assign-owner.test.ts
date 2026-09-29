import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    orgMember: { findFirst: vi.fn(), findMany: vi.fn() },
    campaign: { updateMany: vi.fn() },
    lead: { updateMany: vi.fn() },
    mailbox: { updateMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { assignOwner, listMembers, InvalidOwnerError } from './assign-owner'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  orgMember: { findFirst: Fn; findMany: Fn }
  campaign: { updateMany: Fn }
  lead: { updateMany: Fn }
  mailbox: { updateMany: Fn }
}

beforeEach(() => {
  vi.clearAllMocks()
  p.orgMember.findFirst.mockResolvedValue({ id: 'm-1' })
  p.campaign.updateMany.mockResolvedValue({ count: 1 })
  p.lead.updateMany.mockResolvedValue({ count: 1 })
  p.mailbox.updateMany.mockResolvedValue({ count: 1 })
})

describe('assignOwner', () => {
  it.each([
    ['campaign', () => p.campaign.updateMany],
    ['lead', () => p.lead.updateMany],
    ['mailbox', () => p.mailbox.updateMany],
  ] as const)('org-scoped updateMany for %s', async (entity, getMock) => {
    await assignOwner('org-1', entity, 'e-1', 'm-1')
    expect(getMock()).toHaveBeenCalledWith({
      where: { id: 'e-1', organizationId: 'org-1' },
      data: { ownerId: 'm-1' },
    })
  })

  it('validates ownerId against orgMember before writing', async () => {
    await assignOwner('org-1', 'campaign', 'e-1', 'm-1')
    expect(p.orgMember.findFirst).toHaveBeenCalledWith({
      where: { id: 'm-1', organizationId: 'org-1' },
    })
  })

  it('throws InvalidOwnerError when ownerId is not a member of the org', async () => {
    p.orgMember.findFirst.mockResolvedValue(null)
    await expect(assignOwner('org-1', 'campaign', 'e-1', 'm-bad')).rejects.toThrow(InvalidOwnerError)
    expect(p.campaign.updateMany).not.toHaveBeenCalled()
  })

  it('allows null (unassign) without validating against orgMember', async () => {
    const ok = await assignOwner('org-1', 'lead', 'e-1', null)
    expect(ok).toBe(true)
    expect(p.orgMember.findFirst).not.toHaveBeenCalled()
    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'e-1', organizationId: 'org-1' },
      data: { ownerId: null },
    })
  })

  it('returns false when the entity is not in this org (count 0)', async () => {
    p.mailbox.updateMany.mockResolvedValue({ count: 0 })
    const ok = await assignOwner('org-1', 'mailbox', 'e-1', 'm-1')
    expect(ok).toBe(false)
  })

  it('returns true when the entity was updated', async () => {
    const ok = await assignOwner('org-1', 'campaign', 'e-1', 'm-1')
    expect(ok).toBe(true)
  })
})

describe('listMembers', () => {
  it('lists org members ordered by name', async () => {
    const rows = [{ id: 'm-1', name: 'Alice', email: 'alice@x.com', role: 'admin' }]
    p.orgMember.findMany.mockResolvedValue(rows)

    const result = await listMembers('org-1')

    expect(p.orgMember.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    })
    expect(result).toEqual(rows)
  })
})
