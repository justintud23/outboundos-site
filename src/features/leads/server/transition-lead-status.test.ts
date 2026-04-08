import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findFirst: vi.fn(), update: vi.fn() },
    leadStatusChange: { create: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { transitionLeadStatus } from './transition-lead-status'
import { LeadNotFoundError } from '../types'

const mockFindFirst = prisma.lead.findFirst as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

const ORG = 'org-1'

function makeLead(status: string) {
  return {
    id: 'lead-1',
    organizationId: ORG,
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'Lead',
    company: 'Acme',
    title: null,
    source: 'CSV',
    status,
    score: 80,
    scoreReason: null,
    scoredAt: null,
    createdAt: new Date(),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    return fn({
      lead: { update: vi.fn().mockResolvedValue({ ...makeLead('CONTACTED'), status: 'CONTACTED' }) },
      leadStatusChange: { create: vi.fn().mockResolvedValue({}) },
      sequenceEnrollment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    })
  })
})

describe('transitionLeadStatus', () => {
  it('throws LeadNotFoundError if lead does not exist', async () => {
    mockFindFirst.mockResolvedValue(null)

    await expect(
      transitionLeadStatus({
        organizationId: ORG,
        leadId: 'nonexistent',
        newStatus: 'CONTACTED',
        trigger: 'manual:user',
        actorClerkId: 'user-1',
      }),
    ).rejects.toThrow(LeadNotFoundError)
  })

  it('returns changed: false if status is already the target', async () => {
    mockFindFirst.mockResolvedValue(makeLead('CONTACTED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'CONTACTED',
      trigger: 'auto:message_sent',
    })

    expect(result.changed).toBe(false)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('auto-transitions upgrade status in pipeline order', async () => {
    mockFindFirst.mockResolvedValue(makeLead('NEW'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'CONTACTED',
      trigger: 'auto:message_sent',
    })

    expect(result.changed).toBe(true)
    expect(mockTransaction).toHaveBeenCalled()
  })

  it('auto-transitions do NOT downgrade (INTERESTED → REPLIED is skipped)', async () => {
    mockFindFirst.mockResolvedValue(makeLead('INTERESTED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'REPLIED',
      trigger: 'auto:reply_classification',
    })

    expect(result.changed).toBe(false)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('auto-transitions INTO terminal states always apply', async () => {
    mockFindFirst.mockResolvedValue(makeLead('INTERESTED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'UNSUBSCRIBED',
      trigger: 'auto:reply_classification',
    })

    expect(result.changed).toBe(true)
  })

  it('auto-transitions OUT of terminal states are blocked', async () => {
    mockFindFirst.mockResolvedValue(makeLead('UNSUBSCRIBED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'REPLIED',
      trigger: 'auto:reply_classification',
    })

    expect(result.changed).toBe(false)
  })

  it('manual transitions CAN move out of terminal states', async () => {
    mockFindFirst.mockResolvedValue(makeLead('NOT_INTERESTED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'NEW',
      trigger: 'manual:user',
      actorClerkId: 'user-1',
    })

    expect(result.changed).toBe(true)
  })

  it('manual transitions CAN downgrade in pipeline', async () => {
    mockFindFirst.mockResolvedValue(makeLead('INTERESTED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'NEW',
      trigger: 'manual:user',
      actorClerkId: 'user-1',
    })

    expect(result.changed).toBe(true)
  })
})
