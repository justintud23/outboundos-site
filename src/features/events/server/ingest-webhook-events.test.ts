import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboundMessage: { findUnique: vi.fn() },
    messageEvent:    { upsert: vi.fn() },
  },
}))

vi.mock('@/features/leads/server/transition-lead-status', () => ({
  transitionLeadStatus: vi.fn(),
}))

vi.mock('@/features/mailboxes/server/evaluate-mailbox-breaker', () => ({
  evaluateMailboxBreaker: vi.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { evaluateMailboxBreaker } from '@/features/mailboxes/server/evaluate-mailbox-breaker'
import { LeadNotFoundError } from '@/features/leads/types'
import { ingestWebhookEvents } from './ingest-webhook-events'

const mockFindUnique = prisma.outboundMessage.findUnique as ReturnType<typeof vi.fn>
const mockUpsert    = prisma.messageEvent.upsert    as ReturnType<typeof vi.fn>
const mockTransition = transitionLeadStatus as ReturnType<typeof vi.fn>
const mockBreaker = evaluateMailboxBreaker as ReturnType<typeof vi.fn>

const baseMessage = {
  id: 'msg-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  mailboxId: 'mb-1',
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
      select: { id: true, organizationId: true, leadId: true, mailboxId: true },
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

  // ─── Suppression on unsubscribe / spamreport ──────────────────────────────

  it('suppresses the lead (→ UNSUBSCRIBED) on an unsubscribe event', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    const result = await ingestWebhookEvents([
      { event: 'unsubscribe', sg_event_id: 'evt-u', draftId: 'draft-1', timestamp: 1700000000 },
    ])

    expect(result).toEqual({ processed: 1, skipped: 0 })
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        leadId: 'lead-1',
        newStatus: 'UNSUBSCRIBED',
        trigger: 'auto:sendgrid_unsubscribe',
      }),
    )
  })

  it('suppresses the lead (→ UNSUBSCRIBED) on a spamreport event', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    await ingestWebhookEvents([
      { event: 'spamreport', sg_event_id: 'evt-s', draftId: 'draft-1' },
    ])

    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        leadId: 'lead-1',
        newStatus: 'UNSUBSCRIBED',
        trigger: 'auto:sendgrid_spamreport',
      }),
    )
  })

  it('does not change lead status for non-suppression events (e.g. delivered)', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    await ingestWebhookEvents([
      { event: 'delivered', sg_event_id: 'evt-d', draftId: 'draft-1' },
    ])

    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('is a no-op for an already-terminal lead but still records the event', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})
    // transitionLeadStatus internally no-ops an already-terminal lead.
    mockTransition.mockResolvedValue({ changed: false, lead: {}, previousStatus: 'UNSUBSCRIBED' })

    const result = await ingestWebhookEvents([
      { event: 'unsubscribe', sg_event_id: 'evt-u2', draftId: 'draft-1' },
    ])

    expect(result).toEqual({ processed: 1, skipped: 0 })
    expect(mockUpsert).toHaveBeenCalled()
  })

  it('records the event and does not throw if suppression fails (lead missing)', async () => {
    mockFindUnique.mockResolvedValue({ ...baseMessage, leadId: 'gone' })
    mockUpsert.mockResolvedValue({})
    mockTransition.mockRejectedValue(new LeadNotFoundError('gone'))

    const result = await ingestWebhookEvents([
      { event: 'unsubscribe', sg_event_id: 'evt-u3', draftId: 'draft-1' },
    ])

    expect(result).toEqual({ processed: 1, skipped: 0 })
  })

  // ─── Circuit breaker ──────────────────────────────────────────────────────

  it('evaluates the breaker for the mailbox on a BOUNCED event', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    await ingestWebhookEvents([{ event: 'bounce', sg_event_id: 'evt-b', draftId: 'draft-1' }])

    expect(mockBreaker).toHaveBeenCalledWith('mb-1')
  })

  it('evaluates the breaker on a spamreport event (in addition to lead suppression)', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    await ingestWebhookEvents([{ event: 'spamreport', sg_event_id: 'evt-s', draftId: 'draft-1' }])

    expect(mockBreaker).toHaveBeenCalledWith('mb-1')
    expect(mockTransition).toHaveBeenCalled() // suppression still happens
  })

  it('does NOT evaluate the breaker for non-bounce/spam events (e.g. delivered)', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    await ingestWebhookEvents([{ event: 'delivered', sg_event_id: 'evt-d', draftId: 'draft-1' }])

    expect(mockBreaker).not.toHaveBeenCalled()
  })

  it('best-effort: a breaker failure does not abort the batch; the event is still recorded', async () => {
    mockFindUnique.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})
    mockBreaker.mockRejectedValueOnce(new Error('breaker boom'))

    const result = await ingestWebhookEvents([
      { event: 'bounce', sg_event_id: 'evt-b2', draftId: 'draft-1' },
    ])

    expect(result).toEqual({ processed: 1, skipped: 0 })
    expect(mockUpsert).toHaveBeenCalled()
  })
})
