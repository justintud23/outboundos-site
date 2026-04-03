import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboundMessage: { count: vi.fn() },
    messageEvent:    { groupBy: vi.fn() },
    inboundReply:    { count: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getAnalytics } from './get-analytics'

const mockSentCount    = prisma.outboundMessage.count as ReturnType<typeof vi.fn>
const mockEventGroupBy = prisma.messageEvent.groupBy  as ReturnType<typeof vi.fn>
const mockReplyCount   = prisma.inboundReply.count    as ReturnType<typeof vi.fn>

// Helper sets up all mocks for one scenario.
// groupBy order: DELIVERED → OPENED → CLICKED → BOUNCED → UNSUBSCRIBED
// replyCount order: total → positive
function setupMocks({
  sent = 0,
  delivered = [] as object[],
  opened = [] as object[],
  clicked = [] as object[],
  bounced = [] as object[],
  unsubscribed = [] as object[],
  replies = 0,
  positiveReplies = 0,
} = {}) {
  mockSentCount.mockResolvedValue(sent)
  mockEventGroupBy
    .mockResolvedValueOnce(delivered)
    .mockResolvedValueOnce(opened)
    .mockResolvedValueOnce(clicked)
    .mockResolvedValueOnce(bounced)
    .mockResolvedValueOnce(unsubscribed)
  mockReplyCount
    .mockResolvedValueOnce(replies)
    .mockResolvedValueOnce(positiveReplies)
}

beforeEach(() => vi.clearAllMocks())

describe('getAnalytics', () => {
  it('returns all-zero metrics when org has no data', async () => {
    setupMocks()
    const result = await getAnalytics({ organizationId: 'org-1' })
    expect(result).toEqual({
      sent: 0, delivered: 0, opened: 0, clicked: 0,
      bounced: 0, unsubscribes: 0, replies: 0, positiveReplies: 0,
    })
  })

  it('counts unique messages per event type via groupBy row length', async () => {
    setupMocks({
      sent: 10,
      delivered:    [{ outboundMessageId: 'm1' }, { outboundMessageId: 'm2' }, { outboundMessageId: 'm3' }],
      opened:       [{ outboundMessageId: 'm1' }, { outboundMessageId: 'm2' }],
      clicked:      [{ outboundMessageId: 'm1' }],
      bounced:      [],
      unsubscribed: [{ outboundMessageId: 'm4' }],
      replies: 4, positiveReplies: 2,
    })
    const result = await getAnalytics({ organizationId: 'org-1' })
    expect(result).toEqual({
      sent: 10, delivered: 3, opened: 2, clicked: 1,
      bounced: 0, unsubscribes: 1, replies: 4, positiveReplies: 2,
    })
  })

  it('scopes all queries to the provided organizationId', async () => {
    setupMocks({ sent: 5 })
    await getAnalytics({ organizationId: 'org-abc' })
    expect(mockSentCount).toHaveBeenCalledWith({ where: { organizationId: 'org-abc' } })
    expect(mockEventGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-abc' }) }),
    )
    expect(mockReplyCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-abc' }) }),
    )
  })

  it('queries exactly the five required event types in order', async () => {
    setupMocks()
    await getAnalytics({ organizationId: 'org-1' })
    const eventTypes = (mockEventGroupBy.mock.calls as Array<[{ where: { eventType: string } }]>)
      .map(([arg]) => arg.where.eventType)
    expect(eventTypes).toEqual(['DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'UNSUBSCRIBED'])
  })

  it('counts positive replies separately with classification filter', async () => {
    setupMocks({ replies: 10, positiveReplies: 3 })
    const result = await getAnalytics({ organizationId: 'org-1' })
    expect(result.replies).toBe(10)
    expect(result.positiveReplies).toBe(3)
    const replyCountCalls = mockReplyCount.mock.calls as Array<[{ where: Record<string, unknown> }]>
    expect(replyCountCalls[1][0]).toMatchObject({ where: { classification: 'POSITIVE' } })
  })

  it('isolates to a single org — queries called exactly once per metric', async () => {
    setupMocks({ sent: 5 })
    await getAnalytics({ organizationId: 'org-A' })
    expect(mockSentCount).toHaveBeenCalledTimes(1)
    expect(mockEventGroupBy).toHaveBeenCalledTimes(5)
    expect(mockReplyCount).toHaveBeenCalledTimes(2)
  })
})
