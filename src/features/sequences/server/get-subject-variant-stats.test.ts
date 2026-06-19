import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequenceStep: { findFirst: vi.fn() },
    outboundMessage: { groupBy: vi.fn(), findMany: vi.fn() },
    messageEvent: { groupBy: vi.fn() },
    inboundReply: { groupBy: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getSubjectVariantStats } from './get-subject-variant-stats'

const mockStep = prisma.sequenceStep.findFirst as ReturnType<typeof vi.fn>
const mockOmGroup = prisma.outboundMessage.groupBy as ReturnType<typeof vi.fn>
const mockOmFind = prisma.outboundMessage.findMany as ReturnType<typeof vi.fn>
const mockEventGroup = prisma.messageEvent.groupBy as ReturnType<typeof vi.fn>
const mockReplyGroup = prisma.inboundReply.groupBy as ReturnType<typeof vi.fn>

const INPUT = { organizationId: 'org-1', sequenceStepId: 'step-1' }

beforeEach(() => {
  vi.resetAllMocks()
  mockOmGroup.mockResolvedValue([])
  mockOmFind.mockResolvedValue([])
  mockEventGroup.mockResolvedValue([])
  mockReplyGroup.mockResolvedValue([])
})

describe('getSubjectVariantStats', () => {
  it('returns null when the step is not found / not in org', async () => {
    mockStep.mockResolvedValue(null)
    expect(await getSubjectVariantStats(INPUT)).toBeNull()
  })

  it('reports hasTest=false with no variants', async () => {
    mockStep.mockResolvedValue({ id: 'step-1', winningVariantId: null, subjectVariants: [] })
    const result = await getSubjectVariantStats(INPUT)
    expect(result).toEqual({ sequenceStepId: 'step-1', hasTest: false, winningVariantId: null, variants: [] })
  })

  it('derives per-variant sent/opened/replied counts and rates from events', async () => {
    mockStep.mockResolvedValue({
      id: 'step-1',
      winningVariantId: null,
      subjectVariants: [
        { id: 'v1', subject: 'A', isArchived: false },
        { id: 'v2', subject: 'B', isArchived: false },
      ],
    })
    // v1: 10 sent; v2: 4 sent
    mockOmGroup.mockResolvedValue([
      { subjectVariantId: 'v1', _count: { _all: 10 } },
      { subjectVariantId: 'v2', _count: { _all: 4 } },
    ])
    // opens: messages m1,m2 (v1) and m3 (v2)
    mockEventGroup.mockResolvedValue([
      { outboundMessageId: 'm1', _count: { _all: 1 } },
      { outboundMessageId: 'm2', _count: { _all: 3 } }, // multiple opens, counted once
      { outboundMessageId: 'm3', _count: { _all: 1 } },
    ])
    // replies: message m1 (v1)
    mockReplyGroup.mockResolvedValue([{ outboundMessageId: 'm1', _count: { _all: 1 } }])
    mockOmFind.mockResolvedValue([
      { id: 'm1', subjectVariantId: 'v1' },
      { id: 'm2', subjectVariantId: 'v1' },
      { id: 'm3', subjectVariantId: 'v2' },
    ])

    const result = await getSubjectVariantStats(INPUT)
    const v1 = result!.variants.find((v) => v.id === 'v1')!
    const v2 = result!.variants.find((v) => v.id === 'v2')!

    expect(v1).toMatchObject({ sent: 10, opened: 2, replied: 1, openRate: 0.2, replyRate: 0.1 })
    expect(v2).toMatchObject({ sent: 4, opened: 1, replied: 0, openRate: 0.25, replyRate: 0 })
    expect(result!.hasTest).toBe(true)
  })

  it('does not fabricate confidence on small samples — raw counts, 1/1 = rate 1', async () => {
    mockStep.mockResolvedValue({
      id: 'step-1',
      winningVariantId: null,
      subjectVariants: [
        { id: 'v1', subject: 'A', isArchived: false },
        { id: 'v2', subject: 'B', isArchived: false },
      ],
    })
    // v1 has exactly ONE send that was opened → 1/1. The raw counts make this
    // visibly low-confidence; the UI shows "1/1", not a meaningful "100%".
    mockOmGroup.mockResolvedValue([{ subjectVariantId: 'v1', _count: { _all: 1 } }])
    mockEventGroup.mockResolvedValue([{ outboundMessageId: 'm1', _count: { _all: 1 } }])
    mockOmFind.mockResolvedValue([{ id: 'm1', subjectVariantId: 'v1' }])

    const result = await getSubjectVariantStats(INPUT)
    const v1 = result!.variants.find((v) => v.id === 'v1')!
    const v2 = result!.variants.find((v) => v.id === 'v2')!
    expect(v1.sent).toBe(1)
    expect(v1.opened).toBe(1)
    expect(v1.openRate).toBe(1) // the RAW counts (1/1) are what carry honesty
    // A variant with zero sends reports zeroes, not NaN/Infinity.
    expect(v2).toMatchObject({ sent: 0, opened: 0, openRate: 0, replyRate: 0 })
  })

  it('flags the winner and keeps archived variants for history', async () => {
    mockStep.mockResolvedValue({
      id: 'step-1',
      winningVariantId: 'v1',
      subjectVariants: [
        { id: 'v1', subject: 'A', isArchived: false },
        { id: 'v2', subject: 'B', isArchived: true },
      ],
    })
    const result = await getSubjectVariantStats(INPUT)
    expect(result!.winningVariantId).toBe('v1')
    expect(result!.variants.find((v) => v.id === 'v1')!.isWinner).toBe(true)
    expect(result!.variants.find((v) => v.id === 'v2')!.isArchived).toBe(true)
    // A winner alone still counts as a (concluded) test.
    expect(result!.hasTest).toBe(true)
  })
})
