import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findFirst: vi.fn(), updateMany: vi.fn() },
    sequence: { findFirst: vi.fn() },
    sequenceEnrollment: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { LeadExcludedCanadaError } from '@/features/leads/types'
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
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'UNSUBSCRIBED', email: 'a@acme.com', phone: null, country: null, customFields: null, emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date(), organization: { allowCanadianRecipients: false } })
    await expect(enrollLead(BASE_INPUT)).rejects.toThrow(LeadInTerminalStateError)
  })

  it('throws if already enrolled', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'NEW', email: 'a@acme.com', phone: null, country: null, customFields: null, emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date(), organization: { allowCanadianRecipients: false } })
    mockSeqFind.mockResolvedValue({ id: 'seq-1', steps: [{ stepNumber: 1, delayDays: 0 }] })
    mockEnrollFind.mockResolvedValue({ id: 'existing' })
    await expect(enrollLead(BASE_INPUT)).rejects.toThrow(AlreadyEnrolledError)
  })

  it('throws if sequence has no steps', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'NEW', email: 'a@acme.com', phone: null, country: null, customFields: null, emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date(), organization: { allowCanadianRecipients: false } })
    mockSeqFind.mockResolvedValue({ id: 'seq-1', steps: [] })
    mockEnrollFind.mockResolvedValue(null)
    await expect(enrollLead(BASE_INPUT)).rejects.toThrow(SequenceHasNoStepsError)
  })

  it('creates enrollment with correct nextDueAt', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'NEW', email: 'a@acme.com', phone: null, country: null, customFields: null, emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date(), organization: { allowCanadianRecipients: false } })
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

  it('CASL: refuses to enroll a Canadian lead', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'NEW', email: 'a@acme.com', phone: '(416) 555-0199', country: null, customFields: null, organization: { allowCanadianRecipients: false } })
    await expect(enrollLead({ organizationId: 'org-1', sequenceId: 'seq-1', leadId: 'lead-1', actorClerkId: 'user-1' })).rejects.toBeInstanceOf(LeadExcludedCanadaError)
    expect(mockSeqFind).not.toHaveBeenCalled()
  })
})

describe('enrollLead — email verification queueing', () => {
  const baseLead = { id: 'lead-1', status: 'NEW', email: 'a@acme.com', phone: null, country: null, customFields: null, organization: { allowCanadianRecipients: false } }
  let txLeadUpdateMany: ReturnType<typeof vi.fn>

  function setup(leadOverrides: Record<string, unknown>) {
    mockLeadFind.mockResolvedValue({ ...baseLead, ...leadOverrides })
    mockSeqFind.mockResolvedValue({ id: 'seq-1', steps: [{ stepNumber: 1, delayDays: 0 }] })
    mockEnrollFind.mockResolvedValue(null)
    txLeadUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        sequenceEnrollment: { create: vi.fn().mockResolvedValue({ id: 'enr-1' }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
        lead: { updateMany: txLeadUpdateMany },
      }),
    )
  }

  beforeEach(() => { process.env.MILLIONVERIFIER_API_KEY = 'test-key' })
  afterEach(() => { delete process.env.MILLIONVERIFIER_API_KEY })

  it('queues an unchecked lead for verification', async () => {
    setup({ emailCheck: 'UNCHECKED', emailCheckResult: null, emailCheckedAt: null })
    await enrollLead(BASE_INPUT)
    expect(txLeadUpdateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', emailCheck: { not: 'PENDING' } },
      data: { emailCheck: 'PENDING', emailCheckAttempts: 0 },
    })
  })

  it('does not re-queue a lead verified within 90 days', async () => {
    setup({ emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date(Date.now() - 5 * 86_400_000) })
    await enrollLead(BASE_INPUT)
    expect(txLeadUpdateMany).not.toHaveBeenCalled()
  })

  it('re-queues a result older than 90 days', async () => {
    setup({ emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date(Date.now() - 91 * 86_400_000) })
    await enrollLead(BASE_INPUT)
    expect(txLeadUpdateMany).toHaveBeenCalled()
  })

  it('does nothing when verification is not configured', async () => {
    delete process.env.MILLIONVERIFIER_API_KEY
    setup({ emailCheck: 'UNCHECKED', emailCheckResult: null, emailCheckedAt: null })
    await enrollLead(BASE_INPUT)
    expect(txLeadUpdateMany).not.toHaveBeenCalled()
  })
})
