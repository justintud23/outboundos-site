import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboundMessage: { findMany: vi.fn() },
    inboundReply: { findMany: vi.fn() },
    leadStatusChange: { findMany: vi.fn() },
    sequenceEnrollment: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getLeadTimeline } from './get-lead-timeline'

const mockOutbound = prisma.outboundMessage.findMany as ReturnType<typeof vi.fn>
const mockInbound = prisma.inboundReply.findMany as ReturnType<typeof vi.fn>
const mockStatusChange = prisma.leadStatusChange.findMany as ReturnType<typeof vi.fn>
const mockEnrollment = prisma.sequenceEnrollment.findMany as ReturnType<typeof vi.fn>

const ORG_ID = 'org-1'
const LEAD_ID = 'lead-1'

beforeEach(() => {
  vi.resetAllMocks()
  mockOutbound.mockResolvedValue([])
  mockInbound.mockResolvedValue([])
  mockStatusChange.mockResolvedValue([])
  mockEnrollment.mockResolvedValue([])
})

describe('getLeadTimeline', () => {
  it('returns empty array when no activity', async () => {
    const result = await getLeadTimeline({ organizationId: ORG_ID, leadId: LEAD_ID })
    expect(result).toEqual([])
  })

  it('combines and sorts all event types by timestamp descending', async () => {
    mockOutbound.mockResolvedValue([
      { id: 'msg-1', subject: 'Hello', status: 'SENT', sentAt: new Date('2025-01-10'), createdAt: new Date('2025-01-10') },
    ])
    mockInbound.mockResolvedValue([
      { id: 'reply-1', classification: 'POSITIVE', receivedAt: new Date('2025-01-15') },
    ])
    mockStatusChange.mockResolvedValue([
      { id: 'sc-1', fromStatus: 'NEW', toStatus: 'CONTACTED', trigger: 'MANUAL', createdAt: new Date('2025-01-12') },
    ])
    mockEnrollment.mockResolvedValue([
      { id: 'enr-1', currentStepNumber: 1, status: 'ACTIVE', startedAt: new Date('2025-01-08'), sequence: { name: 'Welcome' } },
    ])

    const result = await getLeadTimeline({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result).toHaveLength(4)
    // Should be sorted newest first
    expect(result[0].type).toBe('REPLY_RECEIVED')
    expect(result[1].type).toBe('STATUS_CHANGE')
    expect(result[2].type).toBe('EMAIL_SENT')
    expect(result[3].type).toBe('SEQUENCE_STEP')
  })

  it('scopes queries to organizationId and leadId', async () => {
    await getLeadTimeline({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(mockOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leadId: LEAD_ID, organizationId: ORG_ID },
      }),
    )
    expect(mockInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leadId: LEAD_ID, organizationId: ORG_ID },
      }),
    )
  })

  it('includes classification metadata for replies', async () => {
    mockInbound.mockResolvedValue([
      { id: 'reply-1', classification: 'NEGATIVE', receivedAt: new Date('2025-01-15') },
    ])

    const result = await getLeadTimeline({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result[0].metadata?.classification).toBe('NEGATIVE')
  })
})
