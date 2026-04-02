import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    draft: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { reviewDraft } from './review-draft'
import { DraftNotFoundError, DraftNotPendingError } from '../types'

const mockPrisma = prisma as unknown as {
  draft: { findFirst: ReturnType<typeof vi.fn> }
  $transaction: ReturnType<typeof vi.fn>
}

beforeEach(() => vi.clearAllMocks())

const pendingDraft = {
  id: 'draft-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  subject: 'Hello Jane',
  body: 'Original body',
  status: 'PENDING_REVIEW',
  promptTemplateId: null,
  createdByClerkId: 'user-1',
  approvedByClerkId: null,
  approvedAt: null,
  rejectedAt: null,
  rejectionReason: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

function makeApprovedDraft(overrides?: Partial<typeof pendingDraft>) {
  return {
    ...pendingDraft,
    status: 'APPROVED',
    approvedByClerkId: 'user-1',
    approvedAt: new Date(),
    ...overrides,
  }
}

const approveInput = {
  organizationId: 'org-1',
  draftId: 'draft-1',
  clerkUserId: 'user-1',
  action: 'approve' as const,
}

describe('reviewDraft', () => {
  it('approves a pending draft and returns updated DraftDTO', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(pendingDraft)
    const approvedDraft = makeApprovedDraft()

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          draft: { update: vi.fn().mockResolvedValue(approvedDraft) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }
        return fn(mockTx)
      },
    )

    const result = await reviewDraft(approveInput)

    expect(result.status).toBe('APPROVED')
    expect(result.approvedByClerkId).toBe('user-1')
  })

  it('approves with edited subject and body', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(pendingDraft)
    const approvedDraft = makeApprovedDraft({ subject: 'Edited subject', body: 'Edited body' })
    let capturedData: unknown

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockUpdate = vi.fn().mockImplementation((args: unknown) => {
          capturedData = args
          return Promise.resolve(approvedDraft)
        })
        const mockTx = {
          draft: { update: mockUpdate },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }
        return fn(mockTx)
      },
    )

    await reviewDraft({
      ...approveInput,
      subject: 'Edited subject',
      body: 'Edited body',
    })

    const data = (capturedData as { data: Record<string, unknown> }).data
    expect(data['subject']).toBe('Edited subject')
    expect(data['body']).toBe('Edited body')
  })

  it('rejects a pending draft', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(pendingDraft)
    const rejectedDraft = {
      ...pendingDraft,
      status: 'REJECTED',
      rejectedAt: new Date(),
      rejectionReason: 'Wrong tone',
    }

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          draft: { update: vi.fn().mockResolvedValue(rejectedDraft) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }
        return fn(mockTx)
      },
    )

    const result = await reviewDraft({
      organizationId: 'org-1',
      draftId: 'draft-1',
      clerkUserId: 'user-1',
      action: 'reject',
      rejectionReason: 'Wrong tone',
    })

    expect(result.status).toBe('REJECTED')
    expect(result.rejectionReason).toBe('Wrong tone')
  })

  it('throws DraftNotFoundError when draft does not exist', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(null)

    await expect(reviewDraft(approveInput)).rejects.toBeInstanceOf(DraftNotFoundError)
  })

  it('throws DraftNotPendingError when draft is already approved', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({
      ...pendingDraft,
      status: 'APPROVED',
    })

    await expect(reviewDraft(approveInput)).rejects.toBeInstanceOf(DraftNotPendingError)
  })
})
