import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequenceEnrollment: { findFirst: vi.fn(), update: vi.fn() },
    draft: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('./check-enrollment-stop', () => ({
  checkEnrollmentStop: vi.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { checkEnrollmentStop } from './check-enrollment-stop'
import { runSequenceStep } from './run-sequence-step'

const mockEnrollmentFind = prisma.sequenceEnrollment.findFirst as ReturnType<typeof vi.fn>
const mockCheckStop = checkEnrollmentStop as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

function makeEnrollment(overrides = {}) {
  return {
    id: 'enroll-1',
    organizationId: 'org-1',
    sequenceId: 'seq-1',
    leadId: 'lead-1',
    currentStepNumber: 0,
    status: 'ACTIVE',
    startedAt: new Date(),
    sequence: {
      campaignId: 'camp-1',
      steps: [
        { id: 'step-1', stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0 },
        { id: 'step-2', stepNumber: 2, subject: 'Follow up', body: 'Just checking', delayDays: 3 },
      ],
    },
    lead: { id: 'lead-1', status: 'NEW' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('runSequenceStep', () => {
  it('returns STOPPED if stop conditions are met', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment())
    mockCheckStop.mockResolvedValue({ shouldStop: true, reason: 'reply_received' })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).toBe('STOPPED')
  })

  it('returns COMPLETED if no more steps', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ currentStepNumber: 2 }))
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).toBe('COMPLETED')
  })

  it('returns DRAFT_GENERATED on successful step execution', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment())
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        draft: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'draft-1' }),
        },
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).toBe('DRAFT_GENERATED')
  })

  it('returns SKIPPED if draft already exists for step', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment())
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        draft: {
          findFirst: vi.fn().mockResolvedValue({ id: 'existing-draft' }),
        },
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).toBe('SKIPPED')
  })
})
