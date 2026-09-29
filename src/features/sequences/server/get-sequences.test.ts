import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequence: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getSequences } from './get-sequences'

const mockFindMany = prisma.sequence.findMany as ReturnType<typeof vi.fn>

const row = (o: Record<string, unknown> = {}) => ({
  id: 'seq-1',
  organizationId: 'org-1',
  campaignId: 'campaign-1',
  name: 'Test Sequence',
  createdAt: new Date('2026-01-01'),
  _count: { steps: 3 },
  enrollments: [],
  ...o,
})

beforeEach(() => vi.clearAllMocks())

describe('getSequences', () => {
  it('returns sequences with computed enrollment counts', async () => {
    mockFindMany.mockResolvedValue([
      row({
        enrollments: [{ status: 'ACTIVE' }, { status: 'ACTIVE' }, { status: 'COMPLETED' }, { status: 'STOPPED' }],
      }),
    ])

    const { sequences, total } = await getSequences({ organizationId: 'org-1' })

    expect(total).toBe(1)
    expect(sequences[0]).toMatchObject({
      id: 'seq-1',
      stepCount: 3,
      activeEnrollments: 2,
      completedEnrollments: 1,
      stoppedEnrollments: 1,
    })
  })

  it('filters by campaignId when provided', async () => {
    mockFindMany.mockResolvedValue([])

    await getSequences({ organizationId: 'org-1', campaignId: 'campaign-9' })

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1', campaignId: 'campaign-9' } }),
    )
  })

  describe('owner filter', () => {
    it('filters by campaign.ownerId when provided', async () => {
      mockFindMany.mockResolvedValue([])

      await getSequences({ organizationId: 'org-1', ownerId: 'm1' })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1', campaign: { ownerId: 'm1' } } }),
      )
    })

    it('leaves the where clause unchanged when ownerId is absent', async () => {
      mockFindMany.mockResolvedValue([])

      await getSequences({ organizationId: 'org-1' })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-1' } }),
      )
    })

    it('combines campaignId and ownerId filters', async () => {
      mockFindMany.mockResolvedValue([])

      await getSequences({ organizationId: 'org-1', campaignId: 'campaign-9', ownerId: 'm1' })

      expect(mockFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org-1', campaignId: 'campaign-9', campaign: { ownerId: 'm1' } },
        }),
      )
    })
  })
})
