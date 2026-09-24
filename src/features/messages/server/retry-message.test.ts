import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { outboundMessage: { updateMany: vi.fn(), findFirst: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { retryFailedMessage } from './retry-message'
import { MessageNotFoundError, MessageNotFailedError } from '../types'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { outboundMessage: { updateMany: Fn; findFirst: Fn } }
const NOW = new Date('2026-09-24T14:00:00Z')

beforeEach(() => vi.resetAllMocks())

describe('retryFailedMessage', () => {
  it('puts a FAILED message back on the queue: QUEUED, attempts 0, error cleared, due now (org-scoped)', async () => {
    p.outboundMessage.updateMany.mockResolvedValue({ count: 1 })
    const out = await retryFailedMessage({ organizationId: 'org-1', messageId: 'msg-1', now: NOW })
    expect(out).toEqual({ id: 'msg-1', status: 'QUEUED' })
    expect(p.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { id: 'msg-1', organizationId: 'org-1', status: 'FAILED' },
      data: {
        status: 'QUEUED',
        sendAttempts: 0,
        lastError: null,
        processing: false,
        processingStartedAt: null,
        scheduledFor: NOW,
      },
    })
  })

  it('404s a message from another org (or missing)', async () => {
    p.outboundMessage.updateMany.mockResolvedValue({ count: 0 })
    p.outboundMessage.findFirst.mockResolvedValue(null)
    await expect(retryFailedMessage({ organizationId: 'org-1', messageId: 'msg-x' })).rejects.toBeInstanceOf(MessageNotFoundError)
    expect(p.outboundMessage.findFirst).toHaveBeenCalledWith({ where: { id: 'msg-x', organizationId: 'org-1' }, select: { status: true } })
  })

  it('refuses a message that is not FAILED (e.g. already SENT)', async () => {
    p.outboundMessage.updateMany.mockResolvedValue({ count: 0 })
    p.outboundMessage.findFirst.mockResolvedValue({ status: 'SENT' })
    await expect(retryFailedMessage({ organizationId: 'org-1', messageId: 'msg-1' })).rejects.toBeInstanceOf(MessageNotFailedError)
  })
})
