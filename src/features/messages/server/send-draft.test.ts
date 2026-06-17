import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    draft: { findFirst: vi.fn() },
    mailbox: { findMany: vi.fn(), updateMany: vi.fn() },
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
  return { ...actual, TERMINAL_STATUSES: ['NOT_INTERESTED', 'UNSUBSCRIBED', 'BOUNCED'] }
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
  DraftSendInProgressError,
} from '@/features/messages/types'
import { DraftNotFoundError } from '@/features/drafts/types'

type Fn = ReturnType<typeof vi.fn>
const mockPrisma = prisma as unknown as {
  draft: { findFirst: Fn }
  mailbox: { findMany: Fn; updateMany: Fn }
  outboundMessage: { create: Fn; findUnique: Fn; update: Fn; delete: Fn }
  $transaction: Fn
}
const mockGetEmailProvider = getEmailProvider as ReturnType<typeof vi.fn>
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
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
  lead: { id: 'lead-1', email: 'jane@acme.com', status: 'NEW' },
}

interface MailboxRow {
  id: string
  organizationId: string
  email: string
  displayName: string
  isActive: boolean
  dailyLimit: number
  sentToday: number
  lastResetAt: Date
}

// ── Typed shapes for the Prisma mock callbacks (no `any`) ──
type IncDec = { increment?: number; decrement?: number }
interface UpdateManyArgs {
  where: { id: string; lastResetAt?: { lt: Date }; sentToday?: { lt?: number; gt?: number } }
  data: { sentToday?: number | IncDec; lastResetAt?: Date }
}
interface FindManyArgs { where: { organizationId: string; isActive: boolean } }
interface CreateArgs { data: Record<string, unknown> }
interface UpdateArgs { where: { id: string }; data: Record<string, unknown> }
interface FindFirstArgs { where: { id: string } }
interface Tx {
  outboundMessage: { update: (a: UpdateArgs) => Promise<unknown> }
  auditLog: { create: (a: { data: unknown }) => Promise<unknown> }
}

// Stateful mailbox store. mailbox.updateMany operates on it with the SAME
// conditional semantics Postgres uses; since JS is single-threaded each
// updateMany call runs atomically end-to-end, faithfully modelling row-level
// atomicity under concurrency.
let store: Record<string, MailboxRow>

function setMailboxes(rows: MailboxRow[]) {
  store = {}
  for (const r of rows) store[r.id] = { ...r }
}

function mailbox(overrides: Partial<MailboxRow> & { id: string }): MailboxRow {
  return {
    organizationId: 'org-1',
    email: `${overrides.id}@company.com`,
    displayName: overrides.id,
    isActive: true,
    dailyLimit: 50,
    sentToday: 0,
    lastResetAt: new Date(), // today
    ...overrides,
  }
}

let omSeq = 0
const baseRow = {
  id: 'msg-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  mailboxId: 'mb-1',
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

const P2002 = new Prisma.PrismaClientKnownRequestError(
  'Unique constraint failed',
  { code: 'P2002', clientVersion: '5.0.0', meta: { target: ['draftId'] } },
)

beforeEach(() => {
  vi.clearAllMocks()
  omSeq = 0
  mockGetEmailProvider.mockReturnValue({ sendEmail: mockSendEmail })
  mockSendEmail.mockResolvedValue({ sgMessageId: 'sg-default' })
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'

  setMailboxes([mailbox({ id: 'mb-1', sentToday: 5 })])

  mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)

  // findMany returns CLONED snapshots (a read, not a live ref).
  mockPrisma.mailbox.findMany.mockImplementation(async ({ where }: FindManyArgs) =>
    Object.values(store)
      .filter((m) => m.organizationId === where.organizationId && m.isActive === where.isActive)
      .map((m) => ({ ...m })),
  )

  // Atomic conditional updateMany simulator: reset / reserve / release.
  mockPrisma.mailbox.updateMany.mockImplementation(async ({ where, data }: UpdateManyArgs) => {
    const row = store[where.id]
    if (!row) return { count: 0 }
    const sd = data.sentToday
    if (where.lastResetAt?.lt !== undefined) {
      // lazy reset (fires at most once per day via the lastResetAt guard)
      if (row.lastResetAt < where.lastResetAt.lt) {
        row.sentToday = typeof sd === 'number' ? sd : 0
        if (data.lastResetAt) row.lastResetAt = data.lastResetAt
        return { count: 1 }
      }
      return { count: 0 }
    }
    if (where.sentToday?.lt !== undefined && typeof sd === 'object' && sd.increment !== undefined) {
      // conditional reserve
      if (row.sentToday < where.sentToday.lt) {
        row.sentToday += sd.increment
        return { count: 1 }
      }
      return { count: 0 }
    }
    if (where.sentToday?.gt !== undefined && typeof sd === 'object' && sd.decrement !== undefined) {
      // guarded release
      if (row.sentToday > where.sentToday.gt) {
        row.sentToday -= sd.decrement
        return { count: 1 }
      }
      return { count: 0 }
    }
    return { count: 0 }
  })

  mockPrisma.outboundMessage.create.mockImplementation(async ({ data }: CreateArgs) => ({
    ...baseRow,
    id: `msg-${++omSeq}`,
    ...data,
  }))
  mockPrisma.outboundMessage.findUnique.mockResolvedValue(null)
  mockPrisma.outboundMessage.update.mockImplementation(async ({ where, data }: UpdateArgs) => ({
    ...baseRow,
    id: where.id,
    ...data,
  }))
  mockPrisma.outboundMessage.delete.mockResolvedValue({})

  // Finalize transaction: outboundMessage.update -> SENT, auditLog.create.
  mockPrisma.$transaction.mockImplementation(async (fn: (tx: Tx) => Promise<unknown>) =>
    fn({
      outboundMessage: {
        update: async ({ where, data }: UpdateArgs) => ({ ...baseRow, id: where.id, ...data }),
      },
      auditLog: { create: async () => ({}) },
    }),
  )
})

describe('sendDraft — atomic daily-limit reservation', () => {
  it('happy path: reserves once, sends, finalizes — counter incremented exactly once', async () => {
    const result = await sendDraft(INPUT)

    expect(result.status).toBe('SENT')
    // 5 -> 6, exactly +1. The finalize transaction does NOT touch the mailbox,
    // so this delta can only come from the single reservation.
    expect(store['mb-1'].sentToday).toBe(6)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    // No rollback on the happy path.
    expect(mockPrisma.outboundMessage.delete).not.toHaveBeenCalled()
  })

  it('throws DraftNotFoundError when draft does not exist', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(null)
    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(DraftNotFoundError)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('throws DraftNotApprovedError when not approved', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ ...fakeDraft, status: 'PENDING_REVIEW' })
    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(DraftNotApprovedError)
  })

  it('throws NoActiveMailboxError when org has no active mailbox', async () => {
    setMailboxes([])
    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(NoActiveMailboxError)
    expect(mockPrisma.outboundMessage.create).not.toHaveBeenCalled()
  })

  it('throws MailboxLimitExceededError when the only mailbox is already full (snapshot)', async () => {
    setMailboxes([mailbox({ id: 'mb-1', sentToday: 50, dailyLimit: 50 })])
    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(MailboxLimitExceededError)
    expect(mockPrisma.outboundMessage.create).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  // ─── The race: N concurrent sends, N > dailyLimit ─────────────────────────

  it('N concurrent sends with dailyLimit=K: exactly K succeed, sentToday ends at exactly K', async () => {
    const K = 2
    const N = 5
    setMailboxes([mailbox({ id: 'mb-1', sentToday: 0, dailyLimit: K })])
    // Distinct drafts so each claims its own row (no dup contention) and all
    // compete for the single mailbox's K slots.
    mockPrisma.draft.findFirst.mockImplementation(async ({ where }: FindFirstArgs) => ({
      ...fakeDraft, id: where.id, leadId: `lead-${where.id}`,
    }))

    const results = await Promise.allSettled(
      Array.from({ length: N }, (_, i) =>
        sendDraft({ organizationId: 'org-1', draftId: `draft-${i}`, clerkUserId: 'user-1' }),
      ),
    )

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]

    expect(fulfilled).toHaveLength(K)
    expect(rejected).toHaveLength(N - K)
    rejected.forEach((r) => expect(r.reason).toBeInstanceOf(MailboxLimitExceededError))

    // Hard guarantee: the counter never exceeds the limit.
    expect(store['mb-1'].sentToday).toBe(K)
    expect(mockSendEmail).toHaveBeenCalledTimes(K)
  })

  // ─── Reservation rollback on send failure ─────────────────────────────────

  it('send failure rolls the reservation back, freeing the slot for a later send', async () => {
    setMailboxes([mailbox({ id: 'mb-1', sentToday: 0, dailyLimit: 5 })])

    // Attempt 1: reservation succeeds (0 -> 1), provider throws -> rollback to 0.
    mockSendEmail.mockRejectedValueOnce(new Error('SendGrid 500'))
    await expect(sendDraft(INPUT)).rejects.toThrow('SendGrid 500')

    expect(store['mb-1'].sentToday).toBe(0) // released back
    expect(mockPrisma.outboundMessage.delete).toHaveBeenCalled() // claim row also released

    // Attempt 2 (retry): the freed slot is usable.
    mockSendEmail.mockResolvedValueOnce({ sgMessageId: 'sg-retry' })
    const result = await sendDraft(INPUT)
    expect(result.status).toBe('SENT')
    expect(store['mb-1'].sentToday).toBe(1)
  })

  // ─── Lazy reset under concurrency ─────────────────────────────────────────

  it('lazy reset under concurrency: first send on a new day resets once, no lost reset / double count', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    // Mailbox is "full" from yesterday; today it should reset and allow K sends.
    setMailboxes([mailbox({ id: 'mb-1', sentToday: 2, dailyLimit: 2, lastResetAt: yesterday })])
    mockPrisma.draft.findFirst.mockImplementation(async ({ where }: FindFirstArgs) => ({
      ...fakeDraft, id: where.id, leadId: `lead-${where.id}`,
    }))

    const results = await Promise.allSettled([
      sendDraft({ organizationId: 'org-1', draftId: 'draft-a', clerkUserId: 'user-1' }),
      sendDraft({ organizationId: 'org-1', draftId: 'draft-b', clerkUserId: 'user-1' }),
    ])

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)
    // Reset to 0 exactly once, then two increments — not 1 (lost reset) and not >2.
    expect(store['mb-1'].sentToday).toBe(2)
    expect(store['mb-1'].lastResetAt.getTime()).toBeGreaterThan(yesterday.getTime())
    expect(mockSendEmail).toHaveBeenCalledTimes(2)
  })

  it('single send on a new day resets the counter and sends', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    setMailboxes([mailbox({ id: 'mb-1', sentToday: 50, dailyLimit: 50, lastResetAt: yesterday })])

    const result = await sendDraft(INPUT)
    expect(result.status).toBe('SENT')
    expect(store['mb-1'].sentToday).toBe(1) // reset to 0, then +1
  })

  // ─── Multi-mailbox rollover when the LRU mailbox fills mid-flight ──────────

  it('rolls to the next eligible mailbox when the LRU choice fills between selection and reservation', async () => {
    // Snapshot shows A as the least-used (so LRU picks it first) and B as a
    // fallback. The STORE, however, has A already at its limit — modelling A
    // filling up in the window between selection and reservation.
    const a = mailbox({ id: 'mb-a', sentToday: 0, dailyLimit: 50, email: 'a@company.com' })
    const b = mailbox({ id: 'mb-b', sentToday: 10, dailyLimit: 50, email: 'b@company.com' })
    setMailboxes([a, b])
    store['mb-a'].sentToday = 50 // A is actually full at reservation time
    mockPrisma.mailbox.findMany.mockResolvedValueOnce([{ ...a, sentToday: 0 }, { ...b }])

    const result = await sendDraft(INPUT)

    expect(result.status).toBe('SENT')
    // Rolled to B: A unchanged (still full), B incremented.
    expect(store['mb-a'].sentToday).toBe(50)
    expect(store['mb-b'].sentToday).toBe(11)
    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ fromEmail: 'b@company.com' }))
  })

  // ─── Rotation/LRU preserved ───────────────────────────────────────────────

  it('rotates to the least-used (LRU) mailbox', async () => {
    setMailboxes([
      mailbox({ id: 'mb-a', sentToday: 10, email: 'a@company.com' }),
      mailbox({ id: 'mb-b', sentToday: 2, email: 'b@company.com' }),
    ])

    await sendDraft(INPUT)

    expect(mockSendEmail).toHaveBeenCalledWith(expect.objectContaining({ fromEmail: 'b@company.com' }))
    expect(store['mb-b'].sentToday).toBe(3) // chosen + reserved
    expect(store['mb-a'].sentToday).toBe(10) // untouched
  })

  // ─── Claim-before-send / dedupe preserved ─────────────────────────────────

  it('already-sent (SENT row exists): claim P2002 → DraftAlreadySentError, no reservation, no send', async () => {
    mockPrisma.outboundMessage.create.mockReset().mockRejectedValue(P2002)
    mockPrisma.outboundMessage.findUnique.mockResolvedValue({ ...baseRow, status: 'SENT' })

    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(DraftAlreadySentError)
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(store['mb-1'].sentToday).toBe(5) // no slot consumed by a dup
  })

  it('fresh in-flight claim: claim P2002 → DraftSendInProgressError, no send', async () => {
    mockPrisma.outboundMessage.create.mockReset().mockRejectedValue(P2002)
    mockPrisma.outboundMessage.findUnique.mockResolvedValue({ ...baseRow, status: 'QUEUED', createdAt: new Date() })

    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(DraftSendInProgressError)
    expect(mockSendEmail).not.toHaveBeenCalled()
    expect(store['mb-1'].sentToday).toBe(5)
  })

  it('concurrent double-invocation of the SAME draft: one sends, the other gets a distinct error', async () => {
    mockPrisma.outboundMessage.create
      .mockReset()
      .mockImplementationOnce(async ({ data }: CreateArgs) => ({ ...baseRow, id: 'msg-win', ...data }))
      .mockRejectedValueOnce(P2002)
    mockPrisma.outboundMessage.findUnique.mockResolvedValue({ ...baseRow, status: 'QUEUED', createdAt: new Date() })

    const [r1, r2] = await Promise.allSettled([sendDraft(INPUT), sendDraft(INPUT)])

    expect([r1.status, r2.status].sort()).toEqual(['fulfilled', 'rejected'])
    const rejected = (r1.status === 'rejected' ? r1 : r2) as PromiseRejectedResult
    expect(rejected.reason).toBeInstanceOf(DraftSendInProgressError)
    expect(mockSendEmail).toHaveBeenCalledTimes(1) // exactly one send
    expect(store['mb-1'].sentToday).toBe(6) // exactly one slot consumed
  })
})
