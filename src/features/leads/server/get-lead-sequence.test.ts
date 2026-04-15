import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequenceEnrollment: { findFirst: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getLeadSequence } from './get-lead-sequence'

const mockFindFirst = prisma.sequenceEnrollment.findFirst as ReturnType<typeof vi.fn>

const ORG_ID = 'org-1'
const LEAD_ID = 'lead-1'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getLeadSequence', () => {
  it('returns null when lead has no enrollment', async () => {
    mockFindFirst.mockResolvedValue(null)

    const result = await getLeadSequence({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result).toBeNull()
  })

  it('returns enrollment details with step info', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'enr-1',
      currentStepNumber: 1,
      status: 'ACTIVE',
      nextDueAt: new Date('2025-02-01'),
      startedAt: new Date('2025-01-01'),
      stoppedAt: null,
      stoppedReason: null,
      sequence: {
        id: 'seq-1',
        name: 'Welcome Flow',
        steps: [
          { stepNumber: 0, subject: 'Intro', delayDays: 0 },
          { stepNumber: 1, subject: 'Follow-up', delayDays: 3 },
          { stepNumber: 2, subject: 'Final', delayDays: 7 },
        ],
      },
    })

    const result = await getLeadSequence({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result).not.toBeNull()
    expect(result!.sequenceName).toBe('Welcome Flow')
    expect(result!.totalSteps).toBe(3)
    expect(result!.currentStepNumber).toBe(1)
    expect(result!.currentStepSubject).toBe('Follow-up')
    expect(result!.nextStepSubject).toBe('Final')
    expect(result!.status).toBe('ACTIVE')
  })

  it('scopes query to organizationId', async () => {
    mockFindFirst.mockResolvedValue(null)

    await getLeadSequence({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { leadId: LEAD_ID, organizationId: ORG_ID },
      }),
    )
  })

  it('returns null for nextStepSubject when on last step', async () => {
    mockFindFirst.mockResolvedValue({
      id: 'enr-1',
      currentStepNumber: 1,
      status: 'ACTIVE',
      nextDueAt: null,
      startedAt: new Date('2025-01-01'),
      stoppedAt: null,
      stoppedReason: null,
      sequence: {
        id: 'seq-1',
        name: 'Short Flow',
        steps: [
          { stepNumber: 0, subject: 'Intro', delayDays: 0 },
          { stepNumber: 1, subject: 'Last Step', delayDays: 3 },
        ],
      },
    })

    const result = await getLeadSequence({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result!.currentStepSubject).toBe('Last Step')
    expect(result!.nextStepSubject).toBeNull()
  })
})
