import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequenceStep: { findUnique: vi.fn() },
    draft: { groupBy: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { selectSubjectVariant } from './select-subject-variant'

const mockStepFind = prisma.sequenceStep.findUnique as ReturnType<typeof vi.fn>
const mockGroupBy = prisma.draft.groupBy as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
})

describe('selectSubjectVariant', () => {
  it('returns null when the step has no variants (no test)', async () => {
    mockStepFind.mockResolvedValue({ winningVariantId: null, winningVariant: null, subjectVariants: [] })
    expect(await selectSubjectVariant(prisma, 'step-1')).toBeNull()
    expect(mockGroupBy).not.toHaveBeenCalled()
  })

  it('returns null for a single variant (single variant = no test)', async () => {
    mockStepFind.mockResolvedValue({
      winningVariantId: null,
      winningVariant: null,
      subjectVariants: [{ id: 'v1', subject: 'A' }],
    })
    expect(await selectSubjectVariant(prisma, 'step-1')).toBeNull()
  })

  it('always returns the winner when one is picked, ignoring assignment counts', async () => {
    mockStepFind.mockResolvedValue({
      winningVariantId: 'v2',
      winningVariant: { id: 'v2', subject: 'Winner' },
      subjectVariants: [
        { id: 'v1', subject: 'A' },
        { id: 'v2', subject: 'Winner' },
      ],
    })
    const result = await selectSubjectVariant(prisma, 'step-1')
    expect(result).toEqual({ variantId: 'v2', subject: 'Winner' })
    expect(mockGroupBy).not.toHaveBeenCalled()
  })

  it('picks the least-assigned variant (balanced round-robin)', async () => {
    mockStepFind.mockResolvedValue({
      winningVariantId: null,
      winningVariant: null,
      subjectVariants: [
        { id: 'v1', subject: 'A' },
        { id: 'v2', subject: 'B' },
      ],
    })
    // v1 already has 3 assignments, v2 has 1 → v2 should win.
    mockGroupBy.mockResolvedValue([
      { subjectVariantId: 'v1', _count: { _all: 3 } },
      { subjectVariantId: 'v2', _count: { _all: 1 } },
    ])
    expect(await selectSubjectVariant(prisma, 'step-1')).toEqual({ variantId: 'v2', subject: 'B' })
  })

  it('breaks ties toward the oldest variant deterministically', async () => {
    mockStepFind.mockResolvedValue({
      winningVariantId: null,
      winningVariant: null,
      subjectVariants: [
        { id: 'v1', subject: 'A' },
        { id: 'v2', subject: 'B' },
      ],
    })
    mockGroupBy.mockResolvedValue([]) // both at 0
    expect(await selectSubjectVariant(prisma, 'step-1')).toEqual({ variantId: 'v1', subject: 'A' })
  })

  it('distributes evenly across N variants over many sends', async () => {
    const variants = [
      { id: 'v1', subject: 'A' },
      { id: 'v2', subject: 'B' },
      { id: 'v3', subject: 'C' },
    ]
    const counts: Record<string, number> = { v1: 0, v2: 0, v3: 0 }

    mockStepFind.mockResolvedValue({ winningVariantId: null, winningVariant: null, subjectVariants: variants })
    mockGroupBy.mockImplementation(async () =>
      Object.entries(counts).map(([subjectVariantId, n]) => ({ subjectVariantId, _count: { _all: n } })),
    )

    for (let i = 0; i < 300; i++) {
      const result = await selectSubjectVariant(prisma, 'step-1')
      counts[result!.variantId]++
    }

    // Perfectly balanced: 300 / 3 each.
    expect(counts).toEqual({ v1: 100, v2: 100, v3: 100 })
  })
})
