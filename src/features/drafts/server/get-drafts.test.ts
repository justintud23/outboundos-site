import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    draft: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getDrafts } from './get-drafts'

const mockPrisma = prisma as unknown as {
  draft: {
    findMany: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => vi.clearAllMocks())

const fakeDraftWithLead = {
  id: 'draft-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  subject: 'Hello Jane',
  body: 'Hi Jane...',
  status: 'PENDING_REVIEW',
  promptTemplateId: null,
  createdByClerkId: 'user-1',
  approvedByClerkId: null,
  approvedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  lead: {
    id: 'lead-1',
    email: 'jane@acme.com',
    firstName: 'Jane',
    lastName: 'Doe',
    company: 'Acme',
  },
  outboundMessages: [] as { id: string; status: string }[],
}

describe('getDrafts', () => {
  it('returns drafts with lead data and total count', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([fakeDraftWithLead])
    mockPrisma.draft.count.mockResolvedValue(1)

    const result = await getDrafts({ organizationId: 'org-1' })

    expect(result.total).toBe(1)
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]?.lead.email).toBe('jane@acme.com')
    expect(result.drafts[0]?.subject).toBe('Hello Jane')
  })

  it('defaults to PENDING_REVIEW, APPROVED, and BLOCKED statuses', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([])
    mockPrisma.draft.count.mockResolvedValue(0)

    await getDrafts({ organizationId: 'org-1' })

    expect(mockPrisma.draft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['PENDING_REVIEW', 'APPROVED', 'BLOCKED'] },
        }),
      }),
    )
  })

  it('uses provided statuses array', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([])
    mockPrisma.draft.count.mockResolvedValue(0)

    await getDrafts({ organizationId: 'org-1', statuses: ['APPROVED'] })

    expect(mockPrisma.draft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['APPROVED'] },
        }),
      }),
    )
  })

  it('caps limit at 200', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([])
    mockPrisma.draft.count.mockResolvedValue(0)

    await getDrafts({ organizationId: 'org-1', limit: 9999 })

    expect(mockPrisma.draft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    )
  })

  it('exposes the draft\'s outbound message (so the UI hides Send for queued/failed drafts)', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([
      { ...fakeDraftWithLead, status: 'APPROVED', outboundMessages: [{ id: 'msg-1', status: 'QUEUED' }] },
      fakeDraftWithLead,
    ])
    mockPrisma.draft.count.mockResolvedValue(2)

    const result = await getDrafts({ organizationId: 'org-1' })

    expect(mockPrisma.draft.findMany.mock.calls[0]?.[0]?.include?.outboundMessages).toEqual({
      select: { id: true, status: true },
      take: 1,
    })
    expect(result.drafts[0]?.outboundMessage).toEqual({ id: 'msg-1', status: 'QUEUED' })
    expect(result.drafts[1]?.outboundMessage).toBeNull()
  })

  it('returns empty list when no drafts exist', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([])
    mockPrisma.draft.count.mockResolvedValue(0)

    const result = await getDrafts({ organizationId: 'org-1' })

    expect(result.drafts).toEqual([])
    expect(result.total).toBe(0)
  })

  it('maps guardrailFlags for BLOCKED drafts', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([{
      ...fakeDraftWithLead,
      status: 'BLOCKED',
      guardrailFlags: [{ rule: 'UNFILLED_TOKEN', match: '{firstName}' }],
    }])
    mockPrisma.draft.count.mockResolvedValue(1)

    const result = await getDrafts({ organizationId: 'org-1' })

    expect(result.drafts[0]?.guardrailFlags).toEqual([{ rule: 'UNFILLED_TOKEN', match: '{firstName}' }])
  })

  it('returns null guardrailFlags when absent', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([fakeDraftWithLead])
    mockPrisma.draft.count.mockResolvedValue(1)

    const result = await getDrafts({ organizationId: 'org-1' })

    expect(result.drafts[0]?.guardrailFlags).toBeNull()
  })
})
