import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    draft: { findFirst: vi.fn() },
    mailbox: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/email', () => ({
  getEmailProvider: vi.fn(),
}))

vi.mock('@/features/leads/server/transition-lead-status', () => ({
  transitionLeadStatus: vi.fn().mockResolvedValue({ changed: true, lead: {}, previousStatus: 'NEW' }),
}))

vi.mock('@/features/leads/types', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    TERMINAL_STATUSES: ['NOT_INTERESTED', 'UNSUBSCRIBED', 'BOUNCED'],
  }
})

import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getEmailProvider } from '@/lib/email'
import { sendDraft } from './send-draft'
import {
  DraftNotApprovedError,
  NoActiveMailboxError,
  MailboxLimitExceededError,
  DraftAlreadySentError,
} from '@/features/messages/types'
import { DraftNotFoundError } from '@/features/drafts/types'

const mockPrisma = prisma as unknown as {
  draft: { findFirst: ReturnType<typeof vi.fn> }
  mailbox: { findMany: ReturnType<typeof vi.fn> }
  $transaction: ReturnType<typeof vi.fn>
}
const mockGetEmailProvider = getEmailProvider as ReturnType<typeof vi.fn>
const mockSendEmail = vi.fn()

const fakeDraft = {
  id: 'draft-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  subject: 'Hello Jane',
  body: 'Hi Jane, ...',
  status: 'APPROVED',
  campaignId: null,
  promptTemplateId: null,
  createdByClerkId: 'user-1',
  approvedByClerkId: 'user-1',
  approvedAt: new Date('2026-01-02'),
  rejectedAt: null,
  rejectionReason: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  lead: { id: 'lead-1', email: 'jane@acme.com', status: 'NEW' },
}

const fakeMailbox = {
  id: 'mailbox-1',
  organizationId: 'org-1',
  email: 'sales@company.com',
  displayName: 'Sales Team',
  isActive: true,
  dailyLimit: 50,
  sentToday: 5,
  lastResetAt: new Date(), // today
}

const fakeMessage = {
  id: 'msg-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  mailboxId: 'mailbox-1',
  campaignId: null,
  draftId: 'draft-1',
  sgMessageId: 'sg-abc-123',
  subject: 'Hello Jane',
  body: 'Hi Jane, ...',
  status: 'SENT',
  sentAt: new Date('2026-01-03'),
  createdAt: new Date('2026-01-03'),
  updatedAt: new Date('2026-01-03'),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetEmailProvider.mockReturnValue({ sendEmail: mockSendEmail })
})

describe('sendDraft', () => {
  it('sends the email and returns OutboundMessageDTO', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([fakeMailbox])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-abc-123' })

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          outboundMessage: { create: vi.fn().mockResolvedValue(fakeMessage) },
          mailbox: { update: vi.fn().mockResolvedValue(fakeMailbox) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }
        return fn(mockTx)
      },
    )

    const result = await sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' })

    expect(result.id).toBe('msg-1')
    expect(result.sgMessageId).toBe('sg-abc-123')
    expect(result.status).toBe('SENT')
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: 'jane@acme.com',
      fromEmail: 'sales@company.com',
      fromName: 'Sales Team',
      subject: 'Hello Jane',
      body: 'Hi Jane, ...',
      customArgs: { draftId: 'draft-1', leadId: 'lead-1' },
    })
  })

  it('throws DraftNotFoundError when draft does not exist', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(null)

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(DraftNotFoundError)
  })

  it('throws DraftNotApprovedError when draft is PENDING_REVIEW', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ ...fakeDraft, status: 'PENDING_REVIEW' })

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(DraftNotApprovedError)
  })

  it('throws DraftAlreadySentError when OutboundMessage already exists for draft', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([fakeMailbox])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-abc' })

    const prismaUniqueError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['draftId'] } },
    )
    mockPrisma.$transaction.mockRejectedValueOnce(prismaUniqueError)

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(DraftAlreadySentError)
  })

  it('throws NoActiveMailboxError when org has no active mailbox', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([])

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(NoActiveMailboxError)
  })

  it('throws MailboxLimitExceededError when daily limit is reached', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([{
      ...fakeMailbox,
      sentToday: 50,
      dailyLimit: 50,
    }])

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(MailboxLimitExceededError)
  })

  it('resets daily count and sends when lastResetAt is from a previous day', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([{
      ...fakeMailbox,
      sentToday: 50,
      dailyLimit: 50,
      lastResetAt: yesterday,
    }])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-xyz' })

    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const mockTx = {
          outboundMessage: { create: vi.fn().mockResolvedValue(fakeMessage) },
          mailbox: { update: vi.fn().mockResolvedValue(fakeMailbox) },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }
        return fn(mockTx)
      },
    )

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).resolves.toBeDefined()
  })

  // ─── Mailbox rotation ────────────────────────────────────────────────────

  function mockTransactionOnce() {
    const txMailboxUpdate = vi.fn().mockResolvedValue({})
    const txOutboundCreate = vi.fn().mockResolvedValue(fakeMessage)
    mockPrisma.$transaction.mockImplementationOnce(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          outboundMessage: { create: txOutboundCreate },
          mailbox: { update: txMailboxUpdate },
          auditLog: { create: vi.fn().mockResolvedValue({}) },
        }),
    )
    return { txMailboxUpdate, txOutboundCreate }
  }

  const today = new Date()
  const mbA = { ...fakeMailbox, id: 'mb-a', email: 'a@company.com', displayName: 'A', sentToday: 10, dailyLimit: 50, lastResetAt: today }
  const mbB = { ...fakeMailbox, id: 'mb-b', email: 'b@company.com', displayName: 'B', sentToday: 2, dailyLimit: 50, lastResetAt: today }

  it('rotates to the least-used (LRU) mailbox rather than the first returned', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    // mbA returned first by Postgres, but mbB has the lower effective sentToday.
    mockPrisma.mailbox.findMany.mockResolvedValue([mbA, mbB])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-b' })
    const { txMailboxUpdate } = mockTransactionOnce()

    await sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' })

    // Sent through mbB (least-used), not mbA which was returned first.
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ fromEmail: 'b@company.com' }))
    expect(txMailboxUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mb-b' } }))
  })

  it('breaks ties on equal usage by oldest lastResetAt', async () => {
    const earlier = new Date(today.getTime() - 60_000) // reset earlier today
    const tieOld = { ...fakeMailbox, id: 'mb-old', email: 'old@company.com', sentToday: 7, lastResetAt: earlier }
    const tieNew = { ...fakeMailbox, id: 'mb-new', email: 'new@company.com', sentToday: 7, lastResetAt: today }

    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([tieNew, tieOld])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-old' })
    const { txMailboxUpdate } = mockTransactionOnce()

    await sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' })

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ fromEmail: 'old@company.com' }))
    expect(txMailboxUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mb-old' } }))
  })

  it('skips a full mailbox in favor of one with headroom', async () => {
    const full = { ...fakeMailbox, id: 'mb-full', email: 'full@company.com', sentToday: 50, dailyLimit: 50, lastResetAt: today }
    const open = { ...fakeMailbox, id: 'mb-open', email: 'open@company.com', sentToday: 30, dailyLimit: 50, lastResetAt: today }

    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    // Full mailbox returned first; it must be skipped even though it sorts ahead.
    mockPrisma.mailbox.findMany.mockResolvedValue([full, open])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-open' })
    const { txMailboxUpdate } = mockTransactionOnce()

    await sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' })

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ fromEmail: 'open@company.com' }))
    expect(txMailboxUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mb-open' } }))
  })

  it('throws MailboxLimitExceededError when every active mailbox is full', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([
      { ...mbA, sentToday: 50, dailyLimit: 50 },
      { ...mbB, sentToday: 50, dailyLimit: 50 },
    ])

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(MailboxLimitExceededError)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
