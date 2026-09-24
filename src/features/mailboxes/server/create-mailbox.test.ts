import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { organization: { findUnique: vi.fn() }, mailbox: { create: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { createMailbox } from './create-mailbox'
import { ManualMailboxNotAllowedError } from '../types'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { organization: { findUnique: Fn }; mailbox: { create: Fn } }

beforeEach(() => vi.resetAllMocks())

describe('createMailbox', () => {
  it('refuses a hand-typed mailbox for an org connected to Microsoft 365 (I3)', async () => {
    p.organization.findUnique.mockResolvedValue({ msTenantId: 'tenant-1' })
    await expect(createMailbox({ organizationId: 'org-1', email: 'a@b.com', displayName: 'A' })).rejects.toBeInstanceOf(
      ManualMailboxNotAllowedError,
    )
    await expect(createMailbox({ organizationId: 'org-1', email: 'a@b.com', displayName: 'A' })).rejects.toThrow(
      /Import mailboxes from Microsoft 365 instead/,
    )
    expect(p.mailbox.create).not.toHaveBeenCalled()
  })

  it('creates the mailbox for an org without Microsoft 365', async () => {
    p.organization.findUnique.mockResolvedValue({ msTenantId: null })
    p.mailbox.create.mockResolvedValue({
      id: 'mb-1', organizationId: 'org-1', email: 'a@b.com', displayName: 'A', isActive: true, dailyLimit: 50,
      sentToday: 0, lastResetAt: new Date(), warmupEnabled: true, warmupStartedAt: new Date(), autoPaused: false,
      pausedAt: null, pauseReason: null, breakerResetAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
    })
    const out = await createMailbox({ organizationId: 'org-1', email: 'a@b.com', displayName: 'A' })
    expect(out.email).toBe('a@b.com')
    expect(p.mailbox.create).toHaveBeenCalledWith({ data: { organizationId: 'org-1', email: 'a@b.com', displayName: 'A' } })
  })
})
