import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    mailbox: { findUnique: vi.fn(), updateMany: vi.fn() },
    outboundMessage: { count: vi.fn() },
    messageEvent: { count: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { evaluateMailboxBreaker } from './evaluate-mailbox-breaker'

type Fn = ReturnType<typeof vi.fn>
const mockPrisma = prisma as unknown as {
  mailbox: { findUnique: Fn; updateMany: Fn }
  outboundMessage: { count: Fn }
  messageEvent: { count: Fn }
}

const NOT_PAUSED = { id: 'mb-1', autoPaused: false, breakerResetAt: new Date('2026-01-01') }

// Wire send/bounce/spam counts. messageEvent.count is called twice (BOUNCED then
// SPAM_REPORT) in order.
function wireCounts({ sends, bounces, spam }: { sends: number; bounces: number; spam: number }) {
  mockPrisma.outboundMessage.count.mockResolvedValue(sends)
  mockPrisma.messageEvent.count.mockResolvedValueOnce(bounces).mockResolvedValueOnce(spam)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrisma.mailbox.updateMany.mockResolvedValue({ count: 1 })
})

describe('evaluateMailboxBreaker', () => {
  it('pauses the mailbox when the bounce rate breaches the threshold', async () => {
    mockPrisma.mailbox.findUnique.mockResolvedValue(NOT_PAUSED)
    wireCounts({ sends: 100, bounces: 8, spam: 0 })

    await evaluateMailboxBreaker('mb-1')

    expect(mockPrisma.mailbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'mb-1', autoPaused: false },
        data: expect.objectContaining({ autoPaused: true, pauseReason: expect.stringMatching(/bounce rate/) }),
      }),
    )
  })

  it('does NOT pause when below threshold', async () => {
    mockPrisma.mailbox.findUnique.mockResolvedValue(NOT_PAUSED)
    wireCounts({ sends: 100, bounces: 2, spam: 0 })

    await evaluateMailboxBreaker('mb-1')

    expect(mockPrisma.mailbox.updateMany).not.toHaveBeenCalled()
  })

  it('does NOT pause below the volume floor even at 100% bounce rate', async () => {
    mockPrisma.mailbox.findUnique.mockResolvedValue(NOT_PAUSED)
    wireCounts({ sends: 5, bounces: 5, spam: 0 })

    await evaluateMailboxBreaker('mb-1')

    expect(mockPrisma.mailbox.updateMany).not.toHaveBeenCalled()
  })

  it('is idempotent: an already-paused mailbox is a no-op (no counts, no update)', async () => {
    mockPrisma.mailbox.findUnique.mockResolvedValue({ ...NOT_PAUSED, autoPaused: true })

    await evaluateMailboxBreaker('mb-1')

    expect(mockPrisma.outboundMessage.count).not.toHaveBeenCalled()
    expect(mockPrisma.messageEvent.count).not.toHaveBeenCalled()
    expect(mockPrisma.mailbox.updateMany).not.toHaveBeenCalled()
  })

  it('no-ops when the mailbox no longer exists', async () => {
    mockPrisma.mailbox.findUnique.mockResolvedValue(null)

    await evaluateMailboxBreaker('mb-gone')

    expect(mockPrisma.mailbox.updateMany).not.toHaveBeenCalled()
  })

  it('pauses on spam complaints at a low rate', async () => {
    mockPrisma.mailbox.findUnique.mockResolvedValue(NOT_PAUSED)
    wireCounts({ sends: 1000, bounces: 0, spam: 2 }) // 0.2% > 0.1%

    await evaluateMailboxBreaker('mb-1')

    expect(mockPrisma.mailbox.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ pauseReason: expect.stringMatching(/spam-complaint rate/) }),
      }),
    )
  })
})
