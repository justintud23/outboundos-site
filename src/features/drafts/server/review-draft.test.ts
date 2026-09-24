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
          draft: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findUnique: vi.fn().mockResolvedValue(approvedDraft),
          },
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
        const mockUpdateMany = vi.fn().mockImplementation((args: unknown) => {
          capturedData = args
          return Promise.resolve({ count: 1 })
        })
        const mockTx = {
          draft: {
            updateMany: mockUpdateMany,
            findUnique: vi.fn().mockResolvedValue(approvedDraft),
          },
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
    // A CHANGED subject marks the draft manual → excluded from A/B variant stats.
    expect(data['subjectEdited']).toBe(true)
  })

  it('does NOT set subjectEdited when the approved subject is unchanged', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(pendingDraft)
    let capturedData: unknown

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockUpdateMany = vi.fn().mockImplementation((args: unknown) => {
          capturedData = args
          return Promise.resolve({ count: 1 })
        })
        const mockTx = {
          draft: {
            updateMany: mockUpdateMany,
            findUnique: vi.fn().mockResolvedValue(makeApprovedDraft()),
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }
        return fn(mockTx)
      },
    )

    // Approving with the SAME subject the draft already has must not flag an edit.
    await reviewDraft({ ...approveInput, subject: pendingDraft.subject })

    const data = (capturedData as { data: Record<string, unknown> }).data
    expect(data['subjectEdited']).toBeUndefined()
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
          draft: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findUnique: vi.fn().mockResolvedValue(rejectedDraft),
          },
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

  it('rejects a pending draft without a rejection reason', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(pendingDraft)
    const rejectedDraft = { ...pendingDraft, status: 'REJECTED', rejectedAt: new Date(), rejectionReason: null }
    let capturedAuditMetadata: unknown

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockAuditCreate = vi.fn().mockImplementation((args: unknown) => {
          capturedAuditMetadata = (args as { data: { metadata: unknown } }).data.metadata
          return Promise.resolve({})
        })
        const mockTx = {
          draft: {
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            findUnique: vi.fn().mockResolvedValue(rejectedDraft),
          },
          auditLog: { create: mockAuditCreate },
        }
        return fn(mockTx)
      },
    )

    const result = await reviewDraft({
      organizationId: 'org-1',
      draftId: 'draft-1',
      clerkUserId: 'user-1',
      action: 'reject',
      // no rejectionReason
    })

    expect(result.status).toBe('REJECTED')
    expect((capturedAuditMetadata as { rejectionReason: unknown }).rejectionReason).toBeNull()
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

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          draft: {
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            findUnique: vi.fn(),
          },
          auditLog: { create: vi.fn() },
        }
        return fn(mockTx)
      },
    )

    await expect(reviewDraft(approveInput)).rejects.toBeInstanceOf(DraftNotPendingError)
  })

  function autoSendTx(campaign: { autoSend: boolean; sampleApprovedAt: Date | null }) {
    const blocked = {
      ...pendingDraft,
      status: 'BLOCKED',
      campaignId: 'c1',
      sequenceEnrollmentId: 'e1',
      subjectVariantId: null,
      subjectEdited: false,
    }
    const approvedRow = { ...blocked, status: 'APPROVED', approvedByClerkId: 'user-1', approvedAt: new Date() }
    const messageCreate = vi.fn().mockResolvedValue({ id: 'msg-1' })
    const draftUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    mockPrisma.draft.findFirst.mockResolvedValue(blocked)
    mockPrisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        draft: {
          updateMany: draftUpdateMany,
          findUnique: vi.fn().mockResolvedValue(approvedRow),
          findUniqueOrThrow: vi.fn().mockResolvedValue(approvedRow),
        },
        campaign: { findUnique: vi.fn().mockResolvedValue(campaign) },
        sequenceEnrollment: { findUnique: vi.fn().mockResolvedValue({ mailboxId: 'mb-1' }) },
        outboundMessage: { create: messageCreate },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }),
    )
    return { messageCreate, draftUpdateMany }
  }

  it('approving a BLOCKED draft on an auto-send campaign with approved sample queues it', async () => {
    const { messageCreate, draftUpdateMany } = autoSendTx({ autoSend: true, sampleApprovedAt: new Date() })
    const result = await reviewDraft(approveInput)
    expect(result.status).toBe('APPROVED')
    expect(draftUpdateMany.mock.calls[0][0].where.status).toEqual({ in: ['PENDING_REVIEW', 'BLOCKED'] })
    expect(messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ draftId: 'draft-1', mailboxId: 'mb-1', status: 'QUEUED', leadId: 'lead-1' }),
    })
  })

  it('approving a draft on a manual campaign does not queue it', async () => {
    const { messageCreate } = autoSendTx({ autoSend: false, sampleApprovedAt: null })
    await reviewDraft(approveInput)
    expect(messageCreate).not.toHaveBeenCalled()
  })

  it('approving on an auto-send campaign whose sample is not yet approved does not queue it', async () => {
    const { messageCreate } = autoSendTx({ autoSend: true, sampleApprovedAt: null })
    await reviewDraft(approveInput)
    expect(messageCreate).not.toHaveBeenCalled()
  })
})
