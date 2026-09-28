import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db/prisma', () => ({ prisma: { mailbox: { count: vi.fn() } } }))
import { prisma } from '@/lib/db/prisma'
import { mailboxOwnerFilter } from './mailbox-owner'
const count = (prisma as unknown as { mailbox: { count: ReturnType<typeof vi.fn> } }).mailbox.count
beforeEach(() => vi.resetAllMocks())

describe('mailboxOwnerFilter', () => {
  it('uses the owner\'s mailboxes when they own any', async () => {
    count.mockResolvedValue(2)
    expect(await mailboxOwnerFilter('org-1', 'm-rep')).toEqual({ ownerId: 'm-rep' })
    expect(count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', ownerId: 'm-rep' } })
  })
  it('falls back to shared mailboxes when the owner has none, or there is no owner (Review Focus #4)', async () => {
    count.mockResolvedValue(0)
    expect(await mailboxOwnerFilter('org-1', 'm-rep')).toEqual({ ownerId: null })
    expect(await mailboxOwnerFilter('org-1', null)).toEqual({ ownerId: null })
  })
})
