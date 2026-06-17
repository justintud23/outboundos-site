import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    draft: { findFirst: vi.fn() },
    mailbox: { findMany: vi.fn() },
    outboundMessage: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/email', () => ({
  getEmailProvider: vi.fn(),
}))

vi.mock('@/lib/email/unsubscribe-token', () => ({
  signUnsubscribeToken: vi.fn(() => 'test-unsub-token'),
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
import { signUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import { sendDraft } from './send-draft'
import {
  DraftNotApprovedError,
  NoActiveMailboxError,
  MailboxLimitExceededError,
  DraftAlreadySentError,
  DraftSendInProgressError,
} from '@/features/messages/types'
import { DraftNotFoundError } from '@/features/drafts/types'

const mockPrisma = prisma as unknown as {
  draft: { findFirst: ReturnType<typeof vi.fn> }
  mailbox: { findMany: ReturnType<typeof vi.fn> }
  outboundMessage: {
    create: ReturnType<typeof vi.fn>
    findUnique: ReturnType<typeof vi.fn>
    update: ReturnType<typeof vi.fn>
    delete: ReturnType<typeof vi.fn>
  }
  $transaction: ReturnType<typeof vi.fn>
}
const mockGetEmailProvider = getEmailProvider as ReturnType<typeof vi.fn>
const mockSignUnsubscribeToken = signUnsubscribeToken as ReturnType<typeof vi.fn>
const mockSendEmail = vi.fn()

const INPUT = { organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }

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

// The claim row, as created BEFORE the send: QUEUED, no sgMessageId yet.
const fakeClaim = {
  id: 'msg-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  mailboxId: 'mailbox-1',
  campaignId: null,
  draftId: 'draft-1',
  sgMessageId: null,
  subject: 'Hello Jane',
  body: 'Hi Jane, ...',
  status: 'QUEUED',
  sentAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

// The finalized row, after the send succeeds and the QUEUED->SENT update lands.
const fakeMessage = {
  ...fakeClaim,
  sgMessageId: 'sg-abc-123',
  status: 'SENT',
  sentAt: new Date('2026-01-03'),
  updatedAt: new Date('2026-01-03'),
}

const P2002 = new Prisma.PrismaClientKnownRequestError(
  'Unique constraint failed',
  { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['draftId'] } },
)

// Mock the finalize transaction: tx.outboundMessage.update flips QUEUED->SENT,
// tx.mailbox.update bumps the counter, tx.auditLog.create records it.
function mockFinalizeTransaction(updateReturn: unknown = fakeMessage) {
  const txOutboundUpdate = vi.fn().mockResolvedValue(updateReturn)
  const txMailboxUpdate = vi.fn().mockResolvedValue({})
  const txAuditCreate = vi.fn().mockResolvedValue({})
  mockPrisma.$transaction.mockImplementationOnce(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        outboundMessage: { update: txOutboundUpdate },
        mailbox: { update: txMailboxUpdate },
        auditLog: { create: txAuditCreate },
      }),
  )
  return { txOutboundUpdate, txMailboxUpdate, txAuditCreate }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetEmailProvider.mockReturnValue({ sendEmail: mockSendEmail })
  mockSignUnsubscribeToken.mockReturnValue('test-unsub-token')
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
  // Sensible defaults; individual tests override as needed.
  mockPrisma.outboundMessage.create.mockResolvedValue(fakeClaim)
  mockPrisma.outboundMessage.delete.mockResolvedValue({})
})

describe('sendDraft', () => {
  it('claims, sends, finalizes: one row, counter incremented once', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([fakeMailbox])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-abc-123' })
    const { txOutboundUpdate, txMailboxUpdate } = mockFinalizeTransaction()

    const result = await sendDraft(INPUT)

    expect(result.status).toBe('SENT')
    expect(result.sgMessageId).toBe('sg-abc-123')

    // Claim is created BEFORE the send, in QUEUED state with no sgMessageId.
    expect(mockPrisma.outboundMessage.create).toHaveBeenCalledTimes(1)
    expect(mockPrisma.outboundMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ draftId: 'draft-1', status: 'QUEUED' }),
      }),
    )
    const createData = mockPrisma.outboundMessage.create.mock.calls[0]?.[0]?.data
    expect(createData?.sgMessageId).toBeUndefined()

    // Send carries the unsubscribe header and runs exactly once.
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'jane@acme.com',
        fromEmail: 'sales@company.com',
        listUnsubscribe: { url: 'https://app.test/api/unsubscribe?token=test-unsub-token' },
      }),
    )

    // Finalize flips the claim to SENT + sgMessageId; counter bumped once.
    expect(txOutboundUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-1' },
        data: expect.objectContaining({ status: 'SENT', sgMessageId: 'sg-abc-123' }),
      }),
    )
    expect(txMailboxUpdate).toHaveBeenCalledTimes(1)
    expect(txMailboxUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mailbox-1' } }))
  })

  it('throws DraftNotFoundError when draft does not exist', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(null)

    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(DraftNotFoundError)
    expect(mockPrisma.outboundMessage.create).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('throws DraftNotApprovedError when draft is PENDING_REVIEW', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ ...fakeDraft, status: 'PENDING_REVIEW' })

    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(DraftNotApprovedError)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('throws NoActiveMailboxError when org has no active mailbox', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([])

    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(NoActiveMailboxError)
    expect(mockPrisma.outboundMessage.create).not.toHaveBeenCalled()
  })

  it('throws MailboxLimitExceededError when daily limit is reached', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([{ ...fakeMailbox, sentToday: 50, dailyLimit: 50 }])

    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(MailboxLimitExceededError)
    // Claim never happens, so the provider is never called.
    expect(mockPrisma.outboundMessage.create).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('resets daily count and sends when lastResetAt is from a previous day', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([
      { ...fakeMailbox, sentToday: 50, dailyLimit: 50, lastResetAt: yesterday },
    ])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-xyz' })
    const { txMailboxUpdate } = mockFinalizeTransaction()

    await expect(sendDraft(INPUT)).resolves.toBeDefined()
    // New day → reset to 1, not increment.
    expect(txMailboxUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sentToday: 1 }) }),
    )
  })

  // ─── Claim-before-send: failure ordering ──────────────────────────────────

  it('concurrent double-invocation: exactly one sends, the other gets DraftSendInProgressError, no duplicate finalize', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([fakeMailbox])
    // Winner claims; loser's claim insert hits the unique draftId constraint.
    mockPrisma.outboundMessage.create
      .mockReset()
      .mockResolvedValueOnce(fakeClaim)
      .mockRejectedValueOnce(P2002)
    // Loser resolves the existing claim and finds it QUEUED + fresh (in-flight).
    mockPrisma.outboundMessage.findUnique.mockResolvedValue({ ...fakeClaim, status: 'QUEUED', createdAt: new Date() })
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-1' })
    mockFinalizeTransaction()

    const [r1, r2] = await Promise.allSettled([sendDraft(INPUT), sendDraft(INPUT)])

    const statuses = [r1.status, r2.status].sort()
    expect(statuses).toEqual(['fulfilled', 'rejected'])
    const rejected = (r1.status === 'rejected' ? r1 : r2) as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(DraftSendInProgressError)

    // Exactly one provider send, exactly one finalize transaction → no duplicate.
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
  })

  it('already-sent (SENT row exists): claim P2002 → DraftAlreadySentError, no re-send', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([fakeMailbox])
    mockPrisma.outboundMessage.create.mockReset().mockRejectedValue(P2002)
    mockPrisma.outboundMessage.findUnique.mockResolvedValue({ ...fakeMessage, status: 'SENT' })

    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(DraftAlreadySentError)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('send fails after claim: claim row is released (deleted) and a retry then succeeds, sending once', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([fakeMailbox])

    // Attempt 1: claim succeeds, provider throws.
    mockPrisma.outboundMessage.create.mockReset().mockResolvedValueOnce(fakeClaim)
    mockSendEmail.mockRejectedValueOnce(new Error('SendGrid 500'))

    await expect(sendDraft(INPUT)).rejects.toThrow('SendGrid 500')

    // The QUEUED claim is deleted so the draft is NOT wedged as sent.
    expect(mockPrisma.outboundMessage.delete).toHaveBeenCalledWith({ where: { id: 'msg-1' } })
    // No finalize ran on the failed attempt.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled()

    // Attempt 2 (deliberate retry): claim succeeds again, send succeeds.
    mockPrisma.outboundMessage.create.mockResolvedValueOnce(fakeClaim)
    mockSendEmail.mockResolvedValueOnce({ sgMessageId: 'sg-retry' })
    mockFinalizeTransaction()

    const result = await sendDraft(INPUT)
    expect(result.status).toBe('SENT')
    // Provider attempted twice total (1 failed, 1 success) — one real delivery.
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })

  it('retry after a successful send whose finalize-UPDATE failed: reconciles the stale claim, does NOT re-send', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([fakeMailbox])

    // The claim row already exists, QUEUED, with a STALE createdAt (the prior
    // attempt sent but its finalize never landed / the process died).
    const staleClaim = { ...fakeClaim, status: 'QUEUED', createdAt: new Date(Date.now() - 5 * 60 * 1000) }
    mockPrisma.outboundMessage.create.mockReset().mockRejectedValue(P2002)
    mockPrisma.outboundMessage.findUnique.mockResolvedValue(staleClaim)
    mockPrisma.outboundMessage.update.mockResolvedValue({ ...staleClaim, status: 'SENT', sentAt: new Date() })

    const result = await sendDraft(INPUT)

    expect(result.status).toBe('SENT')
    // Critically: the provider is NOT called again — no duplicate email.
    expect(mockSendEmail).not.toHaveBeenCalled()
    // The existing row is reconciled to SENT rather than re-sent.
    expect(mockPrisma.outboundMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-1' },
        data: expect.objectContaining({ status: 'SENT' }),
      }),
    )
  })

  it('fresh in-flight claim on retry: DraftSendInProgressError, no re-send, no reconcile', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([fakeMailbox])
    mockPrisma.outboundMessage.create.mockReset().mockRejectedValue(P2002)
    mockPrisma.outboundMessage.findUnique.mockResolvedValue({ ...fakeClaim, status: 'QUEUED', createdAt: new Date() })

    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(DraftSendInProgressError)
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(mockPrisma.outboundMessage.update).not.toHaveBeenCalled()
  })

  // ─── Mailbox rotation (preserved) ─────────────────────────────────────────

  const today = new Date()
  const mbA = { ...fakeMailbox, id: 'mb-a', email: 'a@company.com', displayName: 'A', sentToday: 10, dailyLimit: 50, lastResetAt: today }
  const mbB = { ...fakeMailbox, id: 'mb-b', email: 'b@company.com', displayName: 'B', sentToday: 2, dailyLimit: 50, lastResetAt: today }

  it('rotates to the least-used (LRU) mailbox rather than the first returned', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([mbA, mbB])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-b' })
    const { txMailboxUpdate } = mockFinalizeTransaction()

    await sendDraft(INPUT)

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ fromEmail: 'b@company.com' }))
    expect(txMailboxUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mb-b' } }))
  })

  it('breaks ties on equal usage by oldest lastResetAt', async () => {
    const earlier = new Date(today.getTime() - 60_000)
    const tieOld = { ...fakeMailbox, id: 'mb-old', email: 'old@company.com', sentToday: 7, lastResetAt: earlier }
    const tieNew = { ...fakeMailbox, id: 'mb-new', email: 'new@company.com', sentToday: 7, lastResetAt: today }

    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([tieNew, tieOld])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-old' })
    const { txMailboxUpdate } = mockFinalizeTransaction()

    await sendDraft(INPUT)

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ fromEmail: 'old@company.com' }))
    expect(txMailboxUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mb-old' } }))
  })

  it('skips a full mailbox in favor of one with headroom', async () => {
    const full = { ...fakeMailbox, id: 'mb-full', email: 'full@company.com', sentToday: 50, dailyLimit: 50, lastResetAt: today }
    const open = { ...fakeMailbox, id: 'mb-open', email: 'open@company.com', sentToday: 30, dailyLimit: 50, lastResetAt: today }

    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([full, open])
    mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-open' })
    const { txMailboxUpdate } = mockFinalizeTransaction()

    await sendDraft(INPUT)

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ fromEmail: 'open@company.com' }))
    expect(txMailboxUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'mb-open' } }))
  })

  it('throws MailboxLimitExceededError when every active mailbox is full', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.mailbox.findMany.mockResolvedValue([
      { ...mbA, sentToday: 50, dailyLimit: 50 },
      { ...mbB, sentToday: 50, dailyLimit: 50 },
    ])

    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(MailboxLimitExceededError)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })
})
