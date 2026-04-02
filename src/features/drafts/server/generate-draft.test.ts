import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    promptTemplate: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/ai', () => ({
  getAIProvider: vi.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { generateDraft } from './generate-draft'
import { PendingDraftExistsError, LeadNotFoundError } from '../types'

const mockPrisma = prisma as unknown as {
  lead: { findFirst: ReturnType<typeof vi.fn> }
  promptTemplate: { findFirst: ReturnType<typeof vi.fn> }
  $transaction: ReturnType<typeof vi.fn>
}

const mockDraftEmail = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(getAIProvider as ReturnType<typeof vi.fn>).mockReturnValue({ draftEmail: mockDraftEmail })
})

const fakeLead = {
  id: 'lead-1',
  email: 'jane@acme.com',
  firstName: 'Jane',
  lastName: 'Doe',
  company: 'Acme',
  title: 'VP',
}

const fakeDraft = {
  id: 'draft-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  subject: 'Hello Jane',
  body: 'Hi Jane...',
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

const input = { organizationId: 'org-1', leadId: 'lead-1', clerkUserId: 'user-1' }

describe('generateDraft', () => {
  it('creates a draft and returns DraftDTO on success', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue(fakeLead)
    mockPrisma.promptTemplate.findFirst.mockResolvedValue(null)
    mockDraftEmail.mockResolvedValue({ subject: 'Hello Jane', body: 'Hi Jane...' })

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          draft: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue(fakeDraft),
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }
        return fn(mockTx)
      },
    )

    const result = await generateDraft(input)

    expect(result.id).toBe('draft-1')
    expect(result.subject).toBe('Hello Jane')
    expect(result.status).toBe('PENDING_REVIEW')
    expect(result.createdByClerkId).toBe('user-1')
  })

  it('uses the active EMAIL_DRAFT prompt template when available', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue(fakeLead)
    mockPrisma.promptTemplate.findFirst.mockResolvedValue({
      id: 'tmpl-1',
      body: 'Custom prompt',
    })
    mockDraftEmail.mockResolvedValue({ subject: 'Custom subject', body: 'Custom body' })

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          draft: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({ ...fakeDraft, promptTemplateId: 'tmpl-1' }),
          },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }
        return fn(mockTx)
      },
    )

    const result = await generateDraft(input)

    expect(mockDraftEmail).toHaveBeenCalledWith(expect.anything(), 'Custom prompt')
    expect(result.promptTemplateId).toBe('tmpl-1')
  })

  it('throws PendingDraftExistsError when a pending draft already exists', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue(fakeLead)
    mockPrisma.promptTemplate.findFirst.mockResolvedValue(null)
    mockDraftEmail.mockResolvedValue({ subject: 'Hello Jane', body: 'Hi Jane...' })

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          draft: {
            findFirst: vi.fn().mockResolvedValue({ id: 'existing-draft-1' }),
            create: vi.fn(),
          },
          auditLog: { create: vi.fn() },
        }
        return fn(mockTx)
      },
    )

    await expect(generateDraft(input)).rejects.toBeInstanceOf(PendingDraftExistsError)
    expect(mockDraftEmail).toHaveBeenCalledTimes(1)
  })

  it('throws if lead is not found', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue(null)

    await expect(generateDraft(input)).rejects.toBeInstanceOf(LeadNotFoundError)
  })
})
