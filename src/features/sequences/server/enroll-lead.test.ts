import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    sequence: { findFirst: vi.fn() },
    sequenceEnrollment: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { enrollLead } from './enroll-lead'
import { LeadInTerminalStateError } from '@/features/leads/types'
import { AlreadyEnrolledError, SequenceHasNoStepsError } from '../types'

const mockLeadFind = prisma.lead.findFirst as ReturnType<typeof vi.fn>
const mockSeqFind = prisma.sequence.findFirst as ReturnType<typeof vi.fn>
const mockEnrollFind = prisma.sequenceEnrollment.findFirst as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

const ORG = 'org-1'
const BASE_INPUT = { organizationId: ORG, sequenceId: 'seq-1', leadId: 'lead-1', actorClerkId: 'user-1' }

beforeEach(() => {
  vi.resetAllMocks()
})

describe('enrollLead', () => {
  it('throws if lead not found', async () => {
    mockLeadFind.mockResolvedValue(null)
    await expect(enrollLead(BASE_INPUT)).rejects.toThrow('Lead not found')
  })

  it('throws if lead is in terminal state', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'UNSUBSCRIBED' })
    await expect(enrollLead(BASE_INPUT)).rejects.toThrow(LeadInTerminalStateError)
  })

  it('throws if already enrolled', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'NEW' })
    mockSeqFind.mockResolvedValue({ id: 'seq-1', steps: [{ stepNumber: 1, delayDays: 0 }] })
    mockEnrollFind.mockResolvedValue({ id: 'existing' })
    await expect(enrollLead(BASE_INPUT)).rejects.toThrow(AlreadyEnrolledError)
  })

  it('throws if sequence has no steps', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'NEW' })
    mockSeqFind.mockResolvedValue({ id: 'seq-1', steps: [] })
    mockEnrollFind.mockResolvedValue(null)
    await expect(enrollLead(BASE_INPUT)).rejects.toThrow(SequenceHasNoStepsError)
  })

  it('creates enrollment with correct nextDueAt', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'NEW' })
    mockSeqFind.mockResolvedValue({ id: 'seq-1', steps: [{ stepNumber: 1, delayDays: 3 }] })
    mockEnrollFind.mockResolvedValue(null)

    const fakeEnrollment = {
      id: 'enroll-1', organizationId: ORG, sequenceId: 'seq-1', leadId: 'lead-1',
      currentStepNumber: 0, status: 'ACTIVE', nextDueAt: new Date(), startedAt: new Date(), stoppedReason: null,
    }
    mockTransaction.mockResolvedValue(fakeEnrollment)

    const result = await enrollLead(BASE_INPUT)
    expect(result.id).toBe('enroll-1')
    expect(result.status).toBe('ACTIVE')
    expect(mockTransaction).toHaveBeenCalled()
  })
})
