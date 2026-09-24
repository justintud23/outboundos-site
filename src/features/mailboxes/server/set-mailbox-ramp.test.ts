import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { mailbox: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() } } }))

import { prisma } from '@/lib/db/prisma'
import { setMailboxRampPreset, restartMailboxRamp } from './set-mailbox-ramp'
import { MailboxNotFoundError } from '../types'

type Fn = ReturnType<typeof vi.fn>
const row = {
  id: 'mb-1', organizationId: 'org-1', email: 'a@x.com', displayName: 'A', isActive: true, dailyLimit: 30, sentToday: 0,
  lastResetAt: new Date(), warmupEnabled: true, warmupStartedAt: new Date(), rampPreset: 'STANDARD', autoPaused: false,
  pausedAt: null, pauseReason: null, createdAt: new Date(), updatedAt: new Date(),
}
beforeEach(() => {
  vi.resetAllMocks()
  ;(prisma.mailbox.updateMany as Fn).mockResolvedValue({ count: 1 })
  ;(prisma.mailbox.findUniqueOrThrow as Fn).mockResolvedValue(row)
})

describe('mailbox ramp actions', () => {
  it('sets the preset org-scoped without touching the ramp day', async () => {
    const dto = await setMailboxRampPreset({ organizationId: 'org-1', mailboxId: 'mb-1', rampPreset: 'STANDARD' })
    expect(prisma.mailbox.updateMany).toHaveBeenCalledWith({ where: { id: 'mb-1', organizationId: 'org-1' }, data: { rampPreset: 'STANDARD' } })
    expect(dto.rampPreset).toBe('STANDARD')
  })
  it('restart sets warmupStartedAt to now and turns the ramp on', async () => {
    await restartMailboxRamp({ organizationId: 'org-1', mailboxId: 'mb-1' })
    expect((prisma.mailbox.updateMany as Fn).mock.calls[0][0].data).toEqual({ warmupStartedAt: expect.any(Date), warmupEnabled: true })
  })
  it('another org\'s mailbox throws MailboxNotFoundError', async () => {
    ;(prisma.mailbox.updateMany as Fn).mockResolvedValue({ count: 0 })
    await expect(restartMailboxRamp({ organizationId: 'org-2', mailboxId: 'mb-1' })).rejects.toBeInstanceOf(MailboxNotFoundError)
  })
})
