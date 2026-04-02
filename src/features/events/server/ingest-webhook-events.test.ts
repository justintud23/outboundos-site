import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboundMessage: { findUnique: vi.fn() },
    messageEvent:    { upsert: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { ingestWebhookEvents } from './ingest-webhook-events'

const mockFindUnique = prisma.outboundMessage.findUnique as ReturnType<typeof vi.fn>
const mockUpsert    = prisma.messageEvent.upsert    as ReturnType<typeof vi.fn>

const baseMessage = {
  id: 'msg-1',
  organizationId: 'org-1',
}

beforeEach(() => vi.clearAllMocks())

describe('ingestWebhookEvents', () => {
  it('creates a MessageEvent for a valid delivered event', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    const result = await ingestWebhookEvents([
      {
        event: 'delivered',
        sg_event_id: 'evt-1',
        draftId: 'draft-1',
        timestamp: 1700000000,
      },
    ])

    expect(result).toEqual({ processed: 1, skipped: 0 })
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { draftId: 'draft-1' },
      select: { id: true, organizationId: true },
    })
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sgEventId: 'evt-1' },
        create: expect.objectContaining({
          sgEventId: 'evt-1',
          outboundMessageId: 'msg-1',
          organizationId: 'org-1',
          eventType: 'DELIVERED',
          providerEventType: 'delivered',
        }),
        update: {},
      }),
    )
  })

  it('skips events with no sg_event_id', async () => {
    const result = await ingestWebhookEvents([{ event: 'delivered', draftId: 'draft-1' }])
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('skips events with no draftId', async () => {
    const result = await ingestWebhookEvents([{ event: 'delivered', sg_event_id: 'evt-2' }])
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('skips events with unknown event type', async () => {
    const result = await ingestWebhookEvents([{ event: 'processed', sg_event_id: 'evt-3', draftId: 'draft-1' }])
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('skips events where OutboundMessage is not found', async () => {
    mockFindUnique.mockResolvedValue(null)
    const result = await ingestWebhookEvents([{ event: 'delivered', sg_event_id: 'evt-4', draftId: 'draft-missing' }])
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('processes multiple events and counts correctly', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    const result = await ingestWebhookEvents([
      { event: 'delivered', sg_event_id: 'evt-5', draftId: 'draft-1', timestamp: 1700000001 },
      { event: 'open',      sg_event_id: 'evt-6', draftId: 'draft-1', timestamp: 1700000002 },
      { event: 'processed', sg_event_id: 'evt-7', draftId: 'draft-1' },
    ])

    expect(result).toEqual({ processed: 2, skipped: 1 })
  })

  it('stores the full raw payload in rawPayload', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    const rawEvent = { event: 'click', sg_event_id: 'evt-8', draftId: 'draft-1', url: 'https://example.com', timestamp: 1700000003 }
    await ingestWebhookEvents([rawEvent])

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ rawPayload: rawEvent }),
      }),
    )
  })

  it('sets providerTimestamp to null when timestamp is absent', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    await ingestWebhookEvents([{ event: 'open', sg_event_id: 'evt-9', draftId: 'draft-1' }])

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ providerTimestamp: null }),
      }),
    )
  })
})
