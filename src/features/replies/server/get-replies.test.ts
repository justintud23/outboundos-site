import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    inboundReply: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getReplies } from './get-replies'

const mockFindMany = prisma.inboundReply.findMany as ReturnType<typeof vi.fn>
const mockCount    = prisma.inboundReply.count    as ReturnType<typeof vi.fn>

const baseRow = {
  id: 'reply-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  outboundMessageId: null,
  rawBody: 'Sounds great!',
  classification: 'POSITIVE' as const,
  classificationConfidence: 0.92,
  receivedAt: new Date('2026-04-01T10:00:00Z'),
  createdAt: new Date('2026-04-01T10:00:00Z'),
  lead: { email: 'test@example.com' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getReplies', () => {
  it('returns replies with leadEmail and correct total', async () => {
    mockFindMany.mockResolvedValue([baseRow])
    mockCount.mockResolvedValue(1)

    const result = await getReplies({ organizationId: 'org-1' })

    expect(result.replies).toHaveLength(1)
    expect(result.replies[0].leadEmail).toBe('test@example.com')
    expect(result.total).toBe(1)
  })

  it('queries by organizationId and orders by receivedAt desc', async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await getReplies({ organizationId: 'org-1' })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1' },
      orderBy: { receivedAt: 'desc' },
      include: { lead: { select: { email: true } } },
    }))
  })

  it('adds classification to where clause when provided', async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await getReplies({ organizationId: 'org-1', classification: 'POSITIVE' })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', classification: 'POSITIVE' },
    }))
    expect(mockCount).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', classification: 'POSITIVE' },
    })
  })

  it('caps limit at 200', async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await getReplies({ organizationId: 'org-1', limit: 500 })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))
  })

  it('respects offset for pagination', async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await getReplies({ organizationId: 'org-1', offset: 50 })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 50 }))
  })
})
