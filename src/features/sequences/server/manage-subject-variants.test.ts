import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequenceStep: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    subjectVariant: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import {
  createSubjectVariant,
  updateSubjectVariant,
  archiveSubjectVariant,
  pickSubjectVariantWinner,
} from './manage-subject-variants'
import {
  SubjectVariantStepNotFoundError,
  SubjectVariantNotFirstStepError,
  SubjectVariantNotFoundError,
} from '../types'

const mockStepFind = prisma.sequenceStep.findFirst as ReturnType<typeof vi.fn>
const mockStepUpdate = prisma.sequenceStep.update as ReturnType<typeof vi.fn>
const mockVariantCreate = prisma.subjectVariant.create as ReturnType<typeof vi.fn>
const mockVariantUpdateMany = prisma.subjectVariant.updateMany as ReturnType<typeof vi.fn>
const mockVariantFindUniqueOrThrow = prisma.subjectVariant.findUniqueOrThrow as ReturnType<typeof vi.fn>
const mockVariantFindFirst = prisma.subjectVariant.findFirst as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

beforeEach(() => vi.resetAllMocks())

describe('createSubjectVariant', () => {
  it('creates a variant on the first step', async () => {
    mockStepFind.mockResolvedValue({ id: 'step-1', stepNumber: 1, sequence: { organizationId: 'org-1' } })
    mockVariantCreate.mockResolvedValue({ id: 'v1', subject: 'A', isArchived: false })

    const result = await createSubjectVariant({ organizationId: 'org-1', sequenceStepId: 'step-1', subject: 'A' })
    expect(result).toEqual({ id: 'v1', subject: 'A', isArchived: false })
  })

  it('rejects adding a variant to a non-first step (follow-ups thread, not tested)', async () => {
    mockStepFind.mockResolvedValue({ id: 'step-2', stepNumber: 2, sequence: { organizationId: 'org-1' } })
    await expect(
      createSubjectVariant({ organizationId: 'org-1', sequenceStepId: 'step-2', subject: 'A' }),
    ).rejects.toBeInstanceOf(SubjectVariantNotFirstStepError)
    expect(mockVariantCreate).not.toHaveBeenCalled()
  })

  it('throws when the step is not found / not in org', async () => {
    mockStepFind.mockResolvedValue(null)
    await expect(
      createSubjectVariant({ organizationId: 'org-1', sequenceStepId: 'nope', subject: 'A' }),
    ).rejects.toBeInstanceOf(SubjectVariantStepNotFoundError)
  })
})

describe('updateSubjectVariant', () => {
  it('updates an org-scoped variant subject', async () => {
    mockVariantUpdateMany.mockResolvedValue({ count: 1 })
    mockVariantFindUniqueOrThrow.mockResolvedValue({ id: 'v1', subject: 'A2', isArchived: false })
    const result = await updateSubjectVariant({ organizationId: 'org-1', variantId: 'v1', subject: 'A2' })
    expect(result.subject).toBe('A2')
  })

  it('throws when the variant is not in the org', async () => {
    mockVariantUpdateMany.mockResolvedValue({ count: 0 })
    await expect(
      updateSubjectVariant({ organizationId: 'org-1', variantId: 'v1', subject: 'A2' }),
    ).rejects.toBeInstanceOf(SubjectVariantNotFoundError)
  })
})

describe('archiveSubjectVariant', () => {
  it('archives (soft-deletes) and clears a winner pointer if it was the winner', async () => {
    mockVariantFindFirst.mockResolvedValue({ id: 'v1', sequenceStepId: 'step-1' })
    mockTransaction.mockResolvedValue([])
    await archiveSubjectVariant({ organizationId: 'org-1', variantId: 'v1' })
    expect(mockTransaction).toHaveBeenCalledOnce()
  })

  it('throws when the variant is not in the org', async () => {
    mockVariantFindFirst.mockResolvedValue(null)
    await expect(
      archiveSubjectVariant({ organizationId: 'org-1', variantId: 'v1' }),
    ).rejects.toBeInstanceOf(SubjectVariantNotFoundError)
  })
})

describe('pickSubjectVariantWinner', () => {
  it('sets the winner pointer on the step', async () => {
    mockStepFind.mockResolvedValue({ id: 'step-1', stepNumber: 1, sequence: { organizationId: 'org-1' } })
    mockVariantFindFirst.mockResolvedValue({ id: 'v2' })
    mockStepUpdate.mockResolvedValue({})

    await pickSubjectVariantWinner({ organizationId: 'org-1', sequenceStepId: 'step-1', variantId: 'v2' })
    expect(mockStepUpdate).toHaveBeenCalledWith({
      where: { id: 'step-1' },
      data: { winningVariantId: 'v2' },
    })
  })

  it('clears the winner when variantId is null (resume the split)', async () => {
    mockStepFind.mockResolvedValue({ id: 'step-1', stepNumber: 1, sequence: { organizationId: 'org-1' } })
    mockStepUpdate.mockResolvedValue({})

    await pickSubjectVariantWinner({ organizationId: 'org-1', sequenceStepId: 'step-1', variantId: null })
    expect(mockVariantFindFirst).not.toHaveBeenCalled() // no validation needed to clear
    expect(mockStepUpdate).toHaveBeenCalledWith({
      where: { id: 'step-1' },
      data: { winningVariantId: null },
    })
  })

  it('rejects a winner that does not belong to the step', async () => {
    mockStepFind.mockResolvedValue({ id: 'step-1', stepNumber: 1, sequence: { organizationId: 'org-1' } })
    mockVariantFindFirst.mockResolvedValue(null)
    await expect(
      pickSubjectVariantWinner({ organizationId: 'org-1', sequenceStepId: 'step-1', variantId: 'bad' }),
    ).rejects.toBeInstanceOf(SubjectVariantNotFoundError)
    expect(mockStepUpdate).not.toHaveBeenCalled()
  })
})
