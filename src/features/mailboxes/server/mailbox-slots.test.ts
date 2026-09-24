import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { mailbox: { updateMany: vi.fn() } } }))

import { prisma } from '@/lib/db/prisma'
import { reserveMailboxSlot, releaseMailboxSlot, startOfDay } from './mailbox-slots'

const updateMany = prisma.mailbox.updateMany as ReturnType<typeof vi.fn>
beforeEach(() => updateMany.mockReset())

describe('mailbox slots', () => {
  it('reserve: lazy reset then conditional increment guarded by limit and pause flags', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    const sod = startOfDay(new Date('2026-09-23T15:00:00'))
    expect(await reserveMailboxSlot('mb-1', 30, sod)).toBe(true)
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'mb-1', lastResetAt: { lt: sod } },
      data: { sentToday: 0, lastResetAt: sod },
    })
    expect(updateMany.mock.calls[1][0]).toEqual({
      where: { id: 'mb-1', isActive: true, autoPaused: false, sentToday: { lt: 30 } },
      data: { sentToday: { increment: 1 } },
    })
  })
  it('reserve returns false at the limit', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 })
    expect(await reserveMailboxSlot('mb-1', 30, new Date())).toBe(false)
  })
  it('release never underflows', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 })
    await releaseMailboxSlot('mb-1')
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'mb-1', sentToday: { gt: 0 } },
      data: { sentToday: { decrement: 1 } },
    })
  })
})
