import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequence: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/features/content-check/server/content-gate', () => ({ assertContentAllowed: vi.fn() }))
vi.mock('./get-sequence', () => ({ getSequence: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { assertContentAllowed } from '@/features/content-check/server/content-gate'
import { getSequence } from './get-sequence'
import { updateSequence } from './update-sequence'
import { SequenceHasActiveEnrollmentsError } from '../types'

type Fn = ReturnType<typeof vi.fn>
const mockFind = prisma.sequence.findFirst as Fn
const mockTransaction = prisma.$transaction as Fn
const mockAssertAllowed = assertContentAllowed as Fn
const mockGetSequence = getSequence as Fn

const ORG = 'org-1'
const SEQ = 'seq-1'
const CAMPAIGN = 'camp-1'

const sequence = (o: Record<string, unknown> = {}) => ({
  id: SEQ,
  organizationId: ORG,
  campaignId: CAMPAIGN,
  name: 'Existing name',
  _count: { steps: 1 },
  enrollments: [],
  ...o,
})

const newSteps = [{ stepNumber: 1, subject: 'New subject', body: 'New body', delayDays: 0 }]

beforeEach(() => {
  vi.resetAllMocks()
  mockAssertAllowed.mockResolvedValue(undefined)
  mockGetSequence.mockResolvedValue({ id: SEQ })
})

describe('updateSequence', () => {
  it('gates a step replacement with no active enrollments: calls assertContentAllowed with the sequence campaignId before the transaction', async () => {
    mockFind.mockResolvedValue(sequence())
    const tx = { sequence: { update: vi.fn() }, sequenceStep: { deleteMany: vi.fn(), createMany: vi.fn() } }
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

    const callOrder: string[] = []
    mockAssertAllowed.mockImplementation(async () => {
      callOrder.push('gate')
    })
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => {
      callOrder.push('transaction')
      return cb(tx)
    })

    await updateSequence({ organizationId: ORG, sequenceId: SEQ, newSteps })

    expect(mockAssertAllowed).toHaveBeenCalledWith({
      organizationId: ORG,
      campaignId: CAMPAIGN,
      apply: expect.any(Function),
    })
    expect(callOrder).toEqual(['gate', 'transaction'])
  })

  it("apply() removes the sequence's old step/variant items and keeps other sequences' items, then appends the new steps", async () => {
    mockFind.mockResolvedValue(sequence())
    const tx = { sequence: { update: vi.fn() }, sequenceStep: { deleteMany: vi.fn(), createMany: vi.fn() } }
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

    await updateSequence({ organizationId: ORG, sequenceId: SEQ, newSteps })

    expect(mockAssertAllowed).toHaveBeenCalledTimes(1)
    const { apply } = mockAssertAllowed.mock.calls[0]![0]

    const otherSeqItem = { key: 'step:seq-2:1', label: 'Other', subject: 'x', body: 'y', isFirstStep: true }
    const otherVariantItem = { key: 'variant:seq-2:v-1', label: 'Other variant', subject: 'x', body: 'y', isFirstStep: true }
    const thisStepItem = { key: `step:${SEQ}:1`, label: 'Old', subject: 'old subject', body: 'old body', isFirstStep: true }
    const thisVariantItem = { key: `variant:${SEQ}:v-old`, label: 'Old variant', subject: 'old', body: 'old body', isFirstStep: true }

    const result = apply([otherSeqItem, otherVariantItem, thisStepItem, thisVariantItem])

    // Other sequences' items are untouched.
    expect(result).toContainEqual(otherSeqItem)
    expect(result).toContainEqual(otherVariantItem)
    // This sequence's old step/variant items are gone.
    expect(result.some((i: { key: string }) => i.key === `step:${SEQ}:1` && i.subject === 'old subject')).toBe(false)
    expect(result.some((i: { key: string }) => i.key === `variant:${SEQ}:v-old`)).toBe(false)
    // The new steps are appended under step:<seqId>:<n> keys.
    expect(result.some((i: { key: string; subject: string }) => i.key === `step:${SEQ}:1` && i.subject === 'New subject')).toBe(true)
  })

  it('does not run the transaction when assertContentAllowed rejects', async () => {
    mockFind.mockResolvedValue(sequence())
    const err = new Error('HIGH risk')
    mockAssertAllowed.mockRejectedValue(err)

    await expect(updateSequence({ organizationId: ORG, sequenceId: SEQ, newSteps })).rejects.toThrow('HIGH risk')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('does not call the gate when only the name changes', async () => {
    mockFind.mockResolvedValue(sequence())
    const tx = { sequence: { update: vi.fn() }, sequenceStep: { deleteMany: vi.fn(), createMany: vi.fn() } }
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

    await updateSequence({ organizationId: ORG, sequenceId: SEQ, name: 'Renamed' })

    expect(mockAssertAllowed).not.toHaveBeenCalled()
    expect(tx.sequence.update).toHaveBeenCalledWith({ where: { id: SEQ }, data: { name: 'Renamed' } })
    expect(tx.sequenceStep.deleteMany).not.toHaveBeenCalled()
  })

  it('does not call the gate or replace steps when there are active enrollments (409s instead)', async () => {
    mockFind.mockResolvedValue(sequence({ enrollments: [{ id: 'enr-1' }] }))

    await expect(updateSequence({ organizationId: ORG, sequenceId: SEQ, newSteps })).rejects.toBeInstanceOf(SequenceHasActiveEnrollmentsError)
    expect(mockAssertAllowed).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
