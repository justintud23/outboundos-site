# Send Approved Drafts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to send APPROVED email drafts via SendGrid, creating an immutable OutboundMessage record and AuditLog entry, with full protection against double-sends and daily mailbox limits.

**Architecture:** Feature-oriented monolith. Email provider abstraction lives in `src/lib/email/` (mirrors `src/lib/ai/`). All business logic in `src/features/messages/server/`. Route handlers are thin (parse → call → respond). The /drafts page is updated to show both PENDING_REVIEW and APPROVED drafts; APPROVED rows get a Send button. SendGrid call happens outside the database transaction to avoid long-running transactions.

**Tech Stack:** Next.js 16 App Router, Prisma v7, @sendgrid/mail v8.1.6 (already installed), Clerk v7, Vitest v4, TypeScript strict + noUncheckedIndexedAccess.

---

## File Map

```
src/lib/email/
  provider.ts              CREATE — EmailProvider interface, SendEmailInput, SendEmailOutput
  sendgrid.ts              CREATE — SendGridProvider (implements EmailProvider)
  sendgrid.test.ts         CREATE — unit tests for SendGridProvider
  index.ts                 CREATE — getEmailProvider() singleton (mirrors src/lib/ai/index.ts)

src/features/messages/
  types.ts                 CREATE — OutboundMessageDTO, error classes

src/features/messages/server/
  send-draft.ts            CREATE — sendDraft server function
  send-draft.test.ts       CREATE — unit tests

src/features/drafts/server/
  get-drafts.ts            MODIFY — accept statuses[] instead of single status; default ['PENDING_REVIEW', 'APPROVED']
  get-drafts.test.ts       MODIFY — update the "defaults to PENDING_REVIEW" test

src/app/api/drafts/[id]/
  send/route.ts            CREATE — POST /api/drafts/[id]/send

src/features/drafts/components/
  drafts-table.tsx         MODIFY — add Send button for APPROVED rows; add onSend/sendingDraftId props

src/app/(dashboard)/drafts/
  drafts-client.tsx        MODIFY — handleDraftReviewed keeps APPROVED in list; add handleSend
```

---

## Task 1: Email Provider Abstraction

**Files:**
- Create: `src/lib/email/provider.ts`
- Create: `src/lib/email/sendgrid.ts`
- Create: `src/lib/email/sendgrid.test.ts`
- Create: `src/lib/email/index.ts`

No TDD for provider interface (no logic). TDD for SendGridProvider.

- [ ] **Step 1: Create provider.ts**

```ts
// src/lib/email/provider.ts

export interface SendEmailInput {
  to: string
  fromEmail: string
  fromName: string
  subject: string
  body: string
  // SendGrid customArgs are attached to the message and echoed back in every
  // webhook event — use for webhook correlation and debugging.
  customArgs?: Record<string, string>
}

export interface SendEmailOutput {
  sgMessageId: string | null
}

export interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<SendEmailOutput>
}
```

- [ ] **Step 2: Write the failing test for SendGridProvider**

```ts
// src/lib/email/sendgrid.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sendgrid/mail', () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn(),
  },
}))

import sgMail from '@sendgrid/mail'
import { SendGridProvider } from './sendgrid'

const mockSgMail = sgMail as unknown as {
  setApiKey: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}

beforeEach(() => vi.clearAllMocks())

describe('SendGridProvider', () => {
  it('calls setApiKey on construction', () => {
    new SendGridProvider('test-key')
    expect(mockSgMail.setApiKey).toHaveBeenCalledWith('test-key')
  })

  it('sends email and returns sgMessageId from response header', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: { 'x-message-id': 'sg-abc-123' }, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    const result = await provider.sendEmail({
      to: 'lead@acme.com',
      fromEmail: 'sender@company.com',
      fromName: 'Sales Team',
      subject: 'Hello Acme',
      body: 'Hi there...',
    })
    expect(result.sgMessageId).toBe('sg-abc-123')
    expect(mockSgMail.send).toHaveBeenCalledWith({
      to: 'lead@acme.com',
      from: { email: 'sender@company.com', name: 'Sales Team' },
      subject: 'Hello Acme',
      text: 'Hi there...',
    })
  })

  it('forwards customArgs to SendGrid when provided', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: { 'x-message-id': 'sg-abc-123' }, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    await provider.sendEmail({
      to: 'lead@acme.com',
      fromEmail: 'sender@company.com',
      fromName: 'Sales Team',
      subject: 'Hello Acme',
      body: 'Hi there...',
      customArgs: { draftId: 'draft-1', leadId: 'lead-1' },
    })
    expect(mockSgMail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        customArgs: { draftId: 'draft-1', leadId: 'lead-1' },
      }),
    )
  })

  it('omits customArgs from SendGrid payload when not provided', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: {}, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    await provider.sendEmail({
      to: 'a@b.com',
      fromEmail: 'c@d.com',
      fromName: 'X',
      subject: 'S',
      body: 'B',
    })
    const callArg = mockSgMail.send.mock.calls[0]?.[0] as Record<string, unknown>
    expect(callArg).not.toHaveProperty('customArgs')
  })

  it('returns null sgMessageId when header is absent', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: {}, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    const result = await provider.sendEmail({
      to: 'a@b.com',
      fromEmail: 'c@d.com',
      fromName: 'X',
      subject: 'S',
      body: 'B',
    })
    expect(result.sgMessageId).toBeNull()
  })

  it('throws when SendGrid returns a non-2xx error', async () => {
    mockSgMail.send.mockRejectedValue(new Error('SendGrid 400 Bad Request'))
    const provider = new SendGridProvider('test-key')
    await expect(
      provider.sendEmail({
        to: 'a@b.com',
        fromEmail: 'c@d.com',
        fromName: 'X',
        subject: 'S',
        body: 'B',
      }),
    ).rejects.toThrow('SendGrid 400 Bad Request')
  })
})
```

- [ ] **Step 3: Run test to confirm failure**

```bash
cd /path/to/outboundos-site && npx vitest run src/lib/email/sendgrid.test.ts
```

Expected: FAIL — `Cannot find module './sendgrid'`

- [ ] **Step 4: Create sendgrid.ts**

```ts
// src/lib/email/sendgrid.ts
import sgMail from '@sendgrid/mail'
import type { EmailProvider, SendEmailInput, SendEmailOutput } from './provider'

export class SendGridProvider implements EmailProvider {
  constructor(apiKey: string) {
    sgMail.setApiKey(apiKey)
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailOutput> {
    const [response] = await sgMail.send({
      to: input.to,
      from: { email: input.fromEmail, name: input.fromName },
      subject: input.subject,
      text: input.body,
      // customArgs are echoed back in every SendGrid webhook event —
      // used for webhook-to-message correlation and debugging.
      ...(input.customArgs && { customArgs: input.customArgs }),
    })

    const headers = response.headers as Record<string, string>
    const sgMessageId = headers['x-message-id'] ?? null

    return { sgMessageId }
  }
}
```

- [ ] **Step 5: Run test to confirm pass**

```bash
npx vitest run src/lib/email/sendgrid.test.ts
```

Expected: PASS (6 tests)

- [ ] **Step 6: Create index.ts**

```ts
// src/lib/email/index.ts
import { SendGridProvider } from './sendgrid'
import type { EmailProvider } from './provider'

// Per-process singleton. Resets on serverless cold starts (harmless).
let _provider: EmailProvider | null = null

export function getEmailProvider(): EmailProvider {
  if (_provider) return _provider

  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) throw new Error('SENDGRID_API_KEY is not set')

  _provider = new SendGridProvider(apiKey)
  return _provider
}

export type { EmailProvider, SendEmailInput, SendEmailOutput } from './provider'
```

- [ ] **Step 7: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add src/lib/email/
git commit -m "feat: add SendGrid email provider abstraction"
```

---

## Task 2: Message Types and Error Classes

**Files:**
- Create: `src/features/messages/types.ts`

No automated tests. Run `npx tsc --noEmit` after.

- [ ] **Step 1: Create types.ts**

```ts
// src/features/messages/types.ts
import type { OutboundMessage } from '@prisma/client'

export type OutboundMessageDTO = Pick<
  OutboundMessage,
  | 'id'
  | 'organizationId'
  | 'leadId'
  | 'mailboxId'
  | 'campaignId'
  | 'draftId'
  | 'sgMessageId'
  | 'subject'
  | 'body'
  | 'status'
  | 'sentAt'
  | 'createdAt'
  | 'updatedAt'
>

export class DraftNotApprovedError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`Draft is not approved (status: ${currentStatus}).`)
    this.name = 'DraftNotApprovedError'
    Object.setPrototypeOf(this, DraftNotApprovedError.prototype)
  }
}

export class NoActiveMailboxError extends Error {
  constructor() {
    super('No active mailbox configured for this organization.')
    this.name = 'NoActiveMailboxError'
    Object.setPrototypeOf(this, NoActiveMailboxError.prototype)
  }
}

export class MailboxLimitExceededError extends Error {
  constructor() {
    super('Daily send limit reached for this mailbox.')
    this.name = 'MailboxLimitExceededError'
    Object.setPrototypeOf(this, MailboxLimitExceededError.prototype)
  }
}

export class DraftAlreadySentError extends Error {
  constructor(public readonly messageId: string) {
    super('This draft has already been sent.')
    this.name = 'DraftAlreadySentError'
    Object.setPrototypeOf(this, DraftAlreadySentError.prototype)
  }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/messages/types.ts
git commit -m "feat: add OutboundMessageDTO and message error classes"
```

---

## Task 3: sendDraft Server Function

**Files:**
- Create: `src/features/messages/server/send-draft.ts`
- Create: `src/features/messages/server/send-draft.test.ts`

**Key behaviors:**
1. Fetch draft org-scoped. Null → `DraftNotFoundError` (imported from `src/features/drafts/types`).
2. `status !== 'APPROVED'` → `DraftNotApprovedError(draft.status)`.
3. Check for existing OutboundMessage with `draftId` → `DraftAlreadySentError(existing.id)`.
4. Fetch first active mailbox. None → `NoActiveMailboxError`.
5. Lazy daily reset: if `mailbox.lastResetAt.toDateString() !== new Date().toDateString()`, treat `effectiveSentToday = 0`.
6. `effectiveSentToday >= mailbox.dailyLimit` → `MailboxLimitExceededError`.
7. Call `getEmailProvider().sendEmail(...)` **OUTSIDE** transaction.
8. Inside `$transaction`: create `OutboundMessage` (status=`SENT`, `sentAt=now`), update mailbox `sentToday`, create `AuditLog`.
9. Return `OutboundMessageDTO`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/messages/server/send-draft.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    draft: { findFirst: vi.fn() },
    outboundMessage: { findFirst: vi.fn() },
    mailbox: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('@/lib/email', () => ({
  getEmailProvider: vi.fn(),
}))

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
  outboundMessage: { findFirst: ReturnType<typeof vi.fn> }
  mailbox: { findFirst: ReturnType<typeof vi.fn> }
  $transaction: ReturnType<typeof vi.fn>
}

const mockGetEmailProvider = getEmailProvider as ReturnType<typeof vi.fn>

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

const mockSendEmail = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockGetEmailProvider.mockReturnValue({ sendEmail: mockSendEmail })
})

describe('sendDraft', () => {
  it('sends the email and returns OutboundMessageDTO', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.outboundMessage.findFirst.mockResolvedValue(null)
    mockPrisma.mailbox.findFirst.mockResolvedValue(fakeMailbox)
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

    const result = await sendDraft({
      organizationId: 'org-1',
      draftId: 'draft-1',
      clerkUserId: 'user-1',
    })

    expect(result.id).toBe('msg-1')
    expect(result.sgMessageId).toBe('sg-abc-123')
    expect(result.status).toBe('SENT')
    expect(mockSendEmail).toHaveBeenCalledWith({
      to: expect.any(String), // lead email fetched from draft's lead — in tests this is not available; see note
      fromEmail: 'sales@company.com',
      fromName: 'Sales Team',
      subject: 'Hello Jane',
      body: 'Hi Jane, ...',
    })
  })

  it('throws DraftNotFoundError when draft does not exist', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(null)

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(DraftNotFoundError)
  })

  it('throws DraftNotApprovedError when draft is PENDING_REVIEW', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({
      ...fakeDraft,
      status: 'PENDING_REVIEW',
    })

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(DraftNotApprovedError)
  })

  it('throws DraftAlreadySentError when OutboundMessage already exists for draft', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.outboundMessage.findFirst.mockResolvedValue({ id: 'msg-existing' })

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(DraftAlreadySentError)
  })

  it('throws NoActiveMailboxError when org has no active mailbox', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.outboundMessage.findFirst.mockResolvedValue(null)
    mockPrisma.mailbox.findFirst.mockResolvedValue(null)

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(NoActiveMailboxError)
  })

  it('throws MailboxLimitExceededError when daily limit is reached', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.outboundMessage.findFirst.mockResolvedValue(null)
    mockPrisma.mailbox.findFirst.mockResolvedValue({
      ...fakeMailbox,
      sentToday: 50,
      dailyLimit: 50,
    })

    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).rejects.toBeInstanceOf(MailboxLimitExceededError)
  })

  it('resets daily count and sends when lastResetAt is from a previous day', async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)

    mockPrisma.draft.findFirst.mockResolvedValue(fakeDraft)
    mockPrisma.outboundMessage.findFirst.mockResolvedValue(null)
    mockPrisma.mailbox.findFirst.mockResolvedValue({
      ...fakeMailbox,
      sentToday: 50, // at limit, but from yesterday — should reset
      dailyLimit: 50,
      lastResetAt: yesterday,
    })
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

    // Should NOT throw — yesterday's count doesn't count
    await expect(
      sendDraft({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user-1' }),
    ).resolves.toBeDefined()
  })
})
```

**Note on the happy-path test:** `sendDraft` needs the lead email to construct the `SendEmailInput.to` field. The `draft` record doesn't include the lead's email — you'll need to include the lead in the `findFirst` query. Update the happy-path test's `mockPrisma.draft.findFirst` return value to include the lead:

```ts
mockPrisma.draft.findFirst.mockResolvedValue({
  ...fakeDraft,
  lead: { email: 'jane@acme.com' },
})
```

And update `fakeDraft` to have the lead included when the `findFirst` includes it.

- [ ] **Step 2: Run test to confirm failure**

```bash
npx vitest run src/features/messages/server/send-draft.test.ts
```

Expected: FAIL — `Cannot find module './send-draft'`

- [ ] **Step 3: Create send-draft.ts**

```ts
// src/features/messages/server/send-draft.ts
import { prisma } from '@/lib/db/prisma'
import { getEmailProvider } from '@/lib/email'
import { DraftNotFoundError } from '@/features/drafts/types'
import type { OutboundMessageDTO } from '../types'
import {
  DraftNotApprovedError,
  DraftAlreadySentError,
  NoActiveMailboxError,
  MailboxLimitExceededError,
} from '../types'

interface SendDraftInput {
  organizationId: string
  draftId: string
  clerkUserId: string
}

export async function sendDraft({
  organizationId,
  draftId,
  clerkUserId,
}: SendDraftInput): Promise<OutboundMessageDTO> {
  // 1. Fetch draft (org-scoped, includes lead for to-address)
  const draft = await prisma.draft.findFirst({
    where: { id: draftId, organizationId },
    include: { lead: { select: { email: true } } },
  })

  if (!draft) throw new DraftNotFoundError()

  if (draft.status !== 'APPROVED') {
    throw new DraftNotApprovedError(draft.status)
  }

  // 2. Prevent double-sends
  const existingMessage = await prisma.outboundMessage.findFirst({
    where: { draftId, organizationId },
    select: { id: true },
  })
  if (existingMessage) throw new DraftAlreadySentError(existingMessage.id)

  // 3. Fetch active mailbox
  const mailbox = await prisma.mailbox.findFirst({
    where: { organizationId, isActive: true },
  })
  if (!mailbox) throw new NoActiveMailboxError()

  // 4. Daily limit check with lazy reset
  const today = new Date()
  const isNewDay = mailbox.lastResetAt.toDateString() !== today.toDateString()
  const effectiveSentToday = isNewDay ? 0 : mailbox.sentToday
  if (effectiveSentToday >= mailbox.dailyLimit) throw new MailboxLimitExceededError()

  // 5. Send via provider — OUTSIDE transaction to avoid long-running transaction
  const { sgMessageId } = await getEmailProvider().sendEmail({
    to: draft.lead.email,
    fromEmail: mailbox.email,
    fromName: mailbox.displayName,
    subject: draft.subject,
    body: draft.body,
    // customArgs are echoed back in every SendGrid webhook event —
    // enables webhook-to-message correlation without a database lookup.
    customArgs: { draftId, leadId: draft.leadId },
  })

  // 6. Write OutboundMessage + update mailbox + AuditLog atomically
  const sentAt = new Date()

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.outboundMessage.create({
      data: {
        organizationId,
        leadId: draft.leadId,
        mailboxId: mailbox.id,
        draftId,
        ...(draft.campaignId && { campaignId: draft.campaignId }),
        sgMessageId,
        subject: draft.subject,
        body: draft.body,
        status: 'SENT',
        sentAt,
      },
    })

    await tx.mailbox.update({
      where: { id: mailbox.id },
      data: isNewDay
        ? { sentToday: 1, lastResetAt: today }
        : { sentToday: { increment: 1 } },
    })

    await tx.auditLog.create({
      data: {
        organizationId,
        actorClerkId: clerkUserId,
        action: 'message.sent',
        entityType: 'OutboundMessage',
        entityId: created.id,
        metadata: { draftId, leadId: draft.leadId, mailboxId: mailbox.id },
      },
    })

    return created
  })

  return {
    id: message.id,
    organizationId: message.organizationId,
    leadId: message.leadId,
    mailboxId: message.mailboxId,
    campaignId: message.campaignId,
    draftId: message.draftId,
    sgMessageId: message.sgMessageId,
    subject: message.subject,
    body: message.body,
    status: message.status,
    sentAt: message.sentAt,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  }
}
```

**Important:** The `draft.lead.email` access requires updating the `findFirst` mock in the test to include `lead: { email: 'jane@acme.com' }` on the returned draft object. Update the happy-path test's mock accordingly before running.

- [ ] **Step 4: Update happy-path test mock to include lead**

In `send-draft.test.ts`, change the `fakeDraft` to include the lead field:

```ts
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
  lead: { email: 'jane@acme.com' },  // ← add this
}
```

And update the happy-path `mockSendEmail` expectation:

```ts
expect(mockSendEmail).toHaveBeenCalledWith({
  to: 'jane@acme.com',
  fromEmail: 'sales@company.com',
  fromName: 'Sales Team',
  subject: 'Hello Jane',
  body: 'Hi Jane, ...',
})
```

- [ ] **Step 5: Run tests to confirm pass**

```bash
npx vitest run src/features/messages/server/send-draft.test.ts
```

Expected: PASS (7 tests)

- [ ] **Step 6: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/features/messages/
git commit -m "feat: add sendDraft server function with mailbox limit guard"
```

---

## Task 4: getDrafts Multi-Status Support

**Files:**
- Modify: `src/features/drafts/server/get-drafts.ts`
- Modify: `src/features/drafts/server/get-drafts.test.ts`

The current `status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'` param is replaced with `statuses?: ('PENDING_REVIEW' | 'APPROVED' | 'REJECTED')[]`. Default: `['PENDING_REVIEW', 'APPROVED']`. This allows the /drafts page to show both pending and approved drafts in one query.

- [ ] **Step 1: Update the test first**

In `src/features/drafts/server/get-drafts.test.ts`, find the test:

```ts
it('defaults to PENDING_REVIEW status', async () => {
  ...
  expect(mockPrisma.draft.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ status: 'PENDING_REVIEW' }),
    }),
  )
})
```

Replace it with:

```ts
it('defaults to PENDING_REVIEW and APPROVED statuses', async () => {
  mockPrisma.draft.findMany.mockResolvedValue([])
  mockPrisma.draft.count.mockResolvedValue(0)

  await getDrafts({ organizationId: 'org-1' })

  expect(mockPrisma.draft.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['PENDING_REVIEW', 'APPROVED'] },
      }),
    }),
  )
})
```

Also add a test for custom statuses:

```ts
it('uses provided statuses array', async () => {
  mockPrisma.draft.findMany.mockResolvedValue([])
  mockPrisma.draft.count.mockResolvedValue(0)

  await getDrafts({ organizationId: 'org-1', statuses: ['APPROVED'] })

  expect(mockPrisma.draft.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['APPROVED'] },
      }),
    }),
  )
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/features/drafts/server/get-drafts.test.ts
```

Expected: FAIL — the `defaults to PENDING_REVIEW` test now fails because name changed and assertion differs.

- [ ] **Step 3: Update get-drafts.ts**

Replace the full file content:

```ts
// src/features/drafts/server/get-drafts.ts
import { prisma } from '@/lib/db/prisma'
import type { DraftWithLeadDTO } from '../types'

interface GetDraftsInput {
  organizationId: string
  statuses?: ('PENDING_REVIEW' | 'APPROVED' | 'REJECTED')[]
  limit?: number
  offset?: number
}

export async function getDrafts({
  organizationId,
  statuses = ['PENDING_REVIEW', 'APPROVED'],
  limit = 50,
  offset = 0,
}: GetDraftsInput): Promise<{ drafts: DraftWithLeadDTO[]; total: number }> {
  const cappedLimit = Math.min(limit, 200)

  const [rows, total] = await Promise.all([
    prisma.draft.findMany({
      where: { organizationId, status: { in: statuses } },
      include: {
        lead: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            company: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: cappedLimit,
      skip: offset,
    }),
    prisma.draft.count({ where: { organizationId, status: { in: statuses } } }),
  ])

  return {
    drafts: rows.map((d) => ({
      id: d.id,
      organizationId: d.organizationId,
      leadId: d.leadId,
      subject: d.subject,
      body: d.body,
      status: d.status,
      promptTemplateId: d.promptTemplateId,
      createdByClerkId: d.createdByClerkId,
      approvedByClerkId: d.approvedByClerkId,
      approvedAt: d.approvedAt,
      rejectedAt: d.rejectedAt,
      rejectionReason: d.rejectionReason,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      lead: d.lead,
    })),
    total,
  }
}
```

- [ ] **Step 4: Run tests to confirm pass**

```bash
npx vitest run src/features/drafts/server/get-drafts.test.ts
```

Expected: PASS (5 tests — 4 existing + 1 new)

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/features/drafts/server/get-drafts.ts src/features/drafts/server/get-drafts.test.ts
git commit -m "feat: getDrafts supports multiple statuses, default PENDING_REVIEW + APPROVED"
```

---

## Task 5: POST /api/drafts/[id]/send Route Handler

**Files:**
- Create: `src/app/api/drafts/[id]/send/route.ts`

No unit tests (thin route handler). Run `npx tsc --noEmit` after.

- [ ] **Step 1: Create the route handler**

```ts
// src/app/api/drafts/[id]/send/route.ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { sendDraft } from '@/features/messages/server/send-draft'
import {
  DraftNotApprovedError,
  DraftAlreadySentError,
  NoActiveMailboxError,
  MailboxLimitExceededError,
} from '@/features/messages/types'
import { DraftNotFoundError } from '@/features/drafts/types'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await auth()

  if (!orgId || !userId) {
    return NextResponse.json(
      { error: 'No active organization. Select an organization to continue.' },
      { status: 403 },
    )
  }

  const { id: draftId } = await params

  try {
    const message = await sendDraft({ organizationId: orgId, draftId, clerkUserId: userId })
    return NextResponse.json(message, { status: 201 })
  } catch (err) {
    if (err instanceof DraftNotFoundError) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }
    if (err instanceof DraftNotApprovedError) {
      return NextResponse.json(
        {
          code: 'DRAFT_NOT_APPROVED',
          currentStatus: err.currentStatus,
          message: err.message,
        },
        { status: 409 },
      )
    }
    if (err instanceof DraftAlreadySentError) {
      return NextResponse.json(
        {
          code: 'DRAFT_ALREADY_SENT',
          messageId: err.messageId,
          message: err.message,
        },
        { status: 409 },
      )
    }
    if (err instanceof NoActiveMailboxError) {
      return NextResponse.json(
        { code: 'NO_ACTIVE_MAILBOX', message: err.message },
        { status: 422 },
      )
    }
    if (err instanceof MailboxLimitExceededError) {
      return NextResponse.json(
        { code: 'MAILBOX_LIMIT_EXCEEDED', message: err.message },
        { status: 429 },
      )
    }
    console.error('[POST /api/drafts/[id]/send]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/app/api/drafts/
git commit -m "feat: add POST /api/drafts/[id]/send route handler"
```

---

## Task 6: UI — Send Action in DraftsTable and DraftsClient

**Files:**
- Modify: `src/features/drafts/components/drafts-table.tsx`
- Modify: `src/app/(dashboard)/drafts/drafts-client.tsx`

**DraftsTable changes:**
- Add `onSend?: (draft: DraftWithLeadDTO) => Promise<void>` and `sendingDraftId?: string | null` props.
- In the Actions column, add a "Send" button for `APPROVED` rows (disabled while `sendingDraftId === draft.id`).
- Update empty state text from "No drafts pending review" to "No drafts".

**DraftsClient changes:**
- `handleDraftReviewed`: APPROVED → update in list (keep, change status badge); REJECTED → remove from list. Currently removes all reviewed drafts.
- Add `sendingDraftId: string | null` state.
- Add `sendError: string | null` state.
- Add `handleSend(draft: DraftWithLeadDTO)`: POST `/api/drafts/[id]/send`, on success remove from list.
- Update the counter label from "X drafts pending review" to "X drafts".
- Mount DraftsTable with new `onSend` and `sendingDraftId` props.

- [ ] **Step 1: Update DraftsTable**

Replace `src/features/drafts/components/drafts-table.tsx` with:

```tsx
import { Badge } from '@/components/ui/badge'
import type { DraftDTO, DraftWithLeadDTO } from '@/features/drafts/types'

interface DraftsTableProps {
  drafts: DraftWithLeadDTO[]
  onReview: (draft: DraftWithLeadDTO) => void
  onSend?: (draft: DraftWithLeadDTO) => Promise<void>
  sendingDraftId?: string | null
}

export function DraftsTable({ drafts, onReview, onSend, sendingDraftId }: DraftsTableProps) {
  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[#94a3b8] text-sm">No drafts</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e2130]">
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Lead</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Subject</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide hidden md:table-cell">Created</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => {
            const displayName =
              [draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') ||
              draft.lead.email
            const isSending = sendingDraftId === draft.id

            return (
              <tr key={draft.id} className="border-b border-[#1e2130] hover:bg-[#1a1d2e] transition-colors">
                <td className="px-4 py-3">
                  <div className="text-[#e2e8f0]">{displayName}</div>
                  <div className="text-[#94a3b8] text-xs">{draft.lead.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[#e2e8f0] truncate block max-w-[200px]">{draft.subject}</span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={draft.status} />
                </td>
                <td className="px-4 py-3 text-[#94a3b8] hidden md:table-cell">
                  {new Date(draft.createdAt).toLocaleDateString('en-US')}
                </td>
                <td className="px-4 py-3">
                  {draft.status === 'PENDING_REVIEW' && (
                    <button
                      onClick={() => onReview(draft)}
                      aria-label={`Review draft for ${displayName}`}
                      className="text-xs px-3 py-1 rounded bg-[#1e2130] hover:bg-[#6366f1] text-[#e2e8f0] transition-colors"
                    >
                      Review
                    </button>
                  )}
                  {draft.status === 'APPROVED' && onSend && (
                    <button
                      onClick={() => void onSend(draft)}
                      disabled={isSending}
                      aria-label={`Send draft to ${displayName}`}
                      className="text-xs px-3 py-1 rounded bg-[#1e3a2e] hover:bg-[#166534] text-[#4ade80] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSending ? 'Sending…' : 'Send'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ status }: { status: DraftDTO['status'] }) {
  if (status === 'PENDING_REVIEW') {
    return <Badge variant="muted">Pending</Badge>
  }
  if (status === 'APPROVED') {
    return <Badge variant="success">Approved</Badge>
  }
  // REJECTED
  return <Badge variant="danger">Rejected</Badge>
}
```

- [ ] **Step 2: Update DraftsClient**

Replace `src/app/(dashboard)/drafts/drafts-client.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { DraftsTable } from '@/features/drafts/components/drafts-table'
import { DraftReviewDrawer } from '@/features/drafts/components/draft-review-drawer'
import type { DraftWithLeadDTO, DraftDTO } from '@/features/drafts/types'

interface DraftsClientProps {
  initialDrafts: DraftWithLeadDTO[]
  initialTotal: number
}

export function DraftsClient({ initialDrafts, initialTotal }: DraftsClientProps) {
  const [drafts, setDrafts] = useState<DraftWithLeadDTO[]>(initialDrafts)
  const [total, setTotal] = useState(initialTotal)
  const [reviewingDraft, setReviewingDraft] = useState<DraftWithLeadDTO | null>(null)
  const [sendingDraftId, setSendingDraftId] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)

  function handleReview(draft: DraftWithLeadDTO) {
    setReviewingDraft(draft)
  }

  function handleDraftReviewed(updatedDraft: DraftDTO) {
    if (updatedDraft.status === 'APPROVED') {
      // Keep in list — approved drafts stay visible so user can send them
      setDrafts((prev) =>
        prev.map((d) => (d.id === updatedDraft.id ? { ...d, ...updatedDraft } : d)),
      )
    } else {
      // Rejected: remove from list and decrement count
      setDrafts((prev) => prev.filter((d) => d.id !== updatedDraft.id))
      setTotal((prev) => Math.max(0, prev - 1))
    }
    setReviewingDraft(null)
  }

  async function handleSend(draft: DraftWithLeadDTO) {
    setSendingDraftId(draft.id)
    setSendError(null)

    const res = await fetch(`/api/drafts/${draft.id}/send`, { method: 'POST' })
    const data = await res.json().catch(() => null)

    setSendingDraftId(null)

    if (!res.ok) {
      const message =
        data?.code === 'MAILBOX_LIMIT_EXCEEDED'
          ? 'Daily send limit reached. Try again tomorrow.'
          : data?.code === 'NO_ACTIVE_MAILBOX'
            ? 'No active mailbox configured. Add a mailbox in Settings.'
            : data?.code === 'DRAFT_ALREADY_SENT'
              ? 'This draft has already been sent.'
              : 'Failed to send — please try again.'
      setSendError(message)
      return
    }

    // Remove sent draft from the list
    setDrafts((prev) => prev.filter((d) => d.id !== draft.id))
    setTotal((prev) => Math.max(0, prev - 1))
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <span className="text-[#94a3b8] text-sm">
            {total.toLocaleString()} draft{total !== 1 ? 's' : ''}
          </span>
        </div>

        {sendError && (
          <div className="text-[#ef4444] text-sm bg-[#2d0f0f] border border-[#7f1d1d] rounded px-4 py-2">
            {sendError}
          </div>
        )}

        <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
          <DraftsTable
            drafts={drafts}
            onReview={handleReview}
            onSend={handleSend}
            sendingDraftId={sendingDraftId}
          />
        </div>
      </div>

      <DraftReviewDrawer
        draft={reviewingDraft}
        onClose={() => setReviewingDraft(null)}
        onReviewed={handleDraftReviewed}
      />
    </>
  )
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/features/drafts/components/drafts-table.tsx src/app/(dashboard)/drafts/drafts-client.tsx
git commit -m "feat: add Send action for approved drafts in drafts page"
```

---

## Acceptance Criteria

| Requirement | Where enforced |
|---|---|
| Send action only for APPROVED drafts | `DraftsTable` renders Send button only when `status === 'APPROVED'` |
| Backend prevents non-APPROVED sends | `sendDraft` throws `DraftNotApprovedError` if status !== APPROVED |
| OutboundMessage created with immutable subject/body snapshot | `send-draft.ts` copies `draft.subject` / `draft.body` directly — no re-fetch |
| sgMessageId stored on OutboundMessage | Set in `OutboundMessage.create` from provider response |
| Initial status = SENT | `status: 'SENT'` in create data (synchronous send) |
| AuditLog entry for send | `action: 'message.sent'`, `entityType: 'OutboundMessage'` |
| No double-sends | `DraftAlreadySentError` thrown if OutboundMessage with `draftId` already exists |
| Daily limit enforced | `MailboxLimitExceededError` thrown when `effectiveSentToday >= dailyLimit` |
| Daily count resets automatically | Lazy reset: if `lastResetAt` is from previous day, treat `effectiveSentToday = 0` |
| All queries org-scoped | Every query includes `organizationId` in `where` clause |
| Structured errors for invalid state | 409 `DRAFT_NOT_APPROVED`, 409 `DRAFT_ALREADY_SENT`, 422 `NO_ACTIVE_MAILBOX`, 429 `MAILBOX_LIMIT_EXCEEDED` |
| Route handler is thin | `send/route.ts` only: auth, await params, call `sendDraft`, handle errors |
| Business logic in features/messages/server | All logic in `send-draft.ts` |

---

## Copy-Paste Prompts

---

### Prompt: Task 1 — Email Provider Abstraction

```
You are implementing Task 1 of OutboundOS Phase 11: the email provider abstraction.

**Context:**
- Feature-oriented monolith, Next.js 16, TypeScript strict + noUncheckedIndexedAccess
- Vitest v4. @sendgrid/mail v8.1.6 is already installed
- Mirror src/lib/ai/ pattern exactly: provider.ts (interface), sendgrid.ts (implementation), index.ts (singleton)
- The singleton is per-process (serverless cold-start resets it — this is acceptable per existing pattern)

**Your task:** Create src/lib/email/ with:
1. provider.ts — EmailProvider interface with sendEmail(SendEmailInput): Promise<SendEmailOutput>
   - SendEmailInput: { to, fromEmail, fromName, subject, body, customArgs?: Record<string, string> }
   - SendEmailOutput: { sgMessageId: string | null }
2. sendgrid.ts — SendGridProvider class implementing EmailProvider
   - constructor(apiKey: string): calls sgMail.setApiKey(apiKey)
   - sendEmail: calls sgMail.send(), spreads customArgs into the payload only when present (use ...(input.customArgs && { customArgs: input.customArgs }))
   - Extracts x-message-id header from response[0]; sgMessageId = header value or null
   - Does NOT catch errors — let SendGrid errors propagate
3. sendgrid.test.ts — 6 tests: setApiKey called on construction, happy path returns sgMessageId, null when header absent, throws on SendGrid error, forwards customArgs when provided, omits customArgs from payload when not provided
4. index.ts — getEmailProvider(): EmailProvider singleton; throws if SENDGRID_API_KEY unset

**Mock pattern for sendgrid.test.ts:**
vi.mock('@sendgrid/mail', () => ({
  default: { setApiKey: vi.fn(), send: vi.fn() }
}))
sgMail.send resolves to [{ statusCode: 202, headers: { 'x-message-id': '...' }, body: '' }, {}]

Follow TDD. Commit: "feat: add SendGrid email provider abstraction"
```

---

### Prompt: Task 2 — Message Types and Error Classes

```
You are implementing Task 2 of OutboundOS Phase 11: message types and error classes.

**Your task:** Create src/features/messages/types.ts with:
- OutboundMessageDTO = Pick<OutboundMessage, 'id' | 'organizationId' | 'leadId' | 'mailboxId' | 'campaignId' | 'draftId' | 'sgMessageId' | 'subject' | 'body' | 'status' | 'sentAt' | 'createdAt' | 'updatedAt'>
- DraftNotApprovedError(currentStatus: string) — "Draft is not approved (status: ${currentStatus})."
- NoActiveMailboxError() — "No active mailbox configured for this organization."
- MailboxLimitExceededError() — "Daily send limit reached for this mailbox."
- DraftAlreadySentError(messageId: string) — "This draft has already been sent."

All error classes need Object.setPrototypeOf(this, ClassName.prototype) and this.name = 'ClassName' for reliable instanceof checks (project convention — see src/features/drafts/types.ts).

No automated tests. Run npx tsc --noEmit, then commit: "feat: add OutboundMessageDTO and message error classes"
```

---

### Prompt: Task 3 — sendDraft Server Function

```
You are implementing Task 3 of OutboundOS Phase 11: the sendDraft server function.

**Context:**
- All business logic in src/features/messages/server/send-draft.ts
- Prisma $transaction uses callback form: prisma.$transaction(async (tx) => { ... })
- SendGrid call goes OUTSIDE the transaction (avoid long-running transactions) — same pattern as AI call in generate-draft.ts
- Import DraftNotFoundError from src/features/drafts/types (not features/messages) — no duplication
- Import error classes from src/features/messages/types
- getEmailProvider() from src/lib/email
- noUncheckedIndexedAccess is on — array[0] is T | undefined, use optional chaining

**Key behaviors (in order):**
1. prisma.draft.findFirst({ where: { id: draftId, organizationId }, include: { lead: { select: { email: true } } } })
   → null: throw DraftNotFoundError
2. draft.status !== 'APPROVED' → throw DraftNotApprovedError(draft.status)
3. prisma.outboundMessage.findFirst({ where: { draftId, organizationId }, select: { id: true } })
   → found: throw DraftAlreadySentError(existing.id)
4. prisma.mailbox.findFirst({ where: { organizationId, isActive: true } })
   → null: throw NoActiveMailboxError
5. Lazy daily reset:
   const isNewDay = mailbox.lastResetAt.toDateString() !== new Date().toDateString()
   const effectiveSentToday = isNewDay ? 0 : mailbox.sentToday
   effectiveSentToday >= mailbox.dailyLimit → throw MailboxLimitExceededError
6. Call getEmailProvider().sendEmail({ to: draft.lead.email, fromEmail: mailbox.email, fromName: mailbox.displayName, subject: draft.subject, body: draft.body, customArgs: { draftId, leadId: draft.leadId } }) — OUTSIDE transaction. customArgs are echoed back in every SendGrid webhook event for correlation.
7. Inside $transaction:
   - tx.outboundMessage.create({ data: { organizationId, leadId: draft.leadId, mailboxId: mailbox.id, draftId, ...(draft.campaignId && { campaignId: draft.campaignId }), sgMessageId, subject: draft.subject, body: draft.body, status: 'SENT', sentAt: new Date() } })
   - tx.mailbox.update({ where: { id: mailbox.id }, data: isNewDay ? { sentToday: 1, lastResetAt: today } : { sentToday: { increment: 1 } } })
   - tx.auditLog.create({ action: 'message.sent', entityType: 'OutboundMessage', entityId: created.id, metadata: { draftId, leadId: draft.leadId, mailboxId: mailbox.id } })
   - return tx.outboundMessage.findUnique({ where: { id: created.id } }) — wait, just return `created` directly, no second query needed
8. Map to OutboundMessageDTO and return

**AuditLog:** action='message.sent', entityType='OutboundMessage', entityId=created.id

**Mock pattern for $transaction in tests:**
mockPrisma.$transaction.mockImplementationOnce(
  async (fn: (tx: unknown) => Promise<unknown>) => {
    const mockTx = {
      outboundMessage: { create: vi.fn().mockResolvedValue(fakeMessage) },
      mailbox: { update: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    return fn(mockTx)
  }
)

**Tests required (7):**
1. Happy path: sends email, returns OutboundMessageDTO with correct fields
2. DraftNotFoundError when draft is null
3. DraftNotApprovedError when status is PENDING_REVIEW
4. DraftAlreadySentError when OutboundMessage with draftId already exists
5. NoActiveMailboxError when no active mailbox
6. MailboxLimitExceededError when sentToday >= dailyLimit
7. Lazy reset: sentToday=50/dailyLimit=50 but lastResetAt=yesterday → does NOT throw, sends successfully

Follow TDD. Commit: "feat: add sendDraft server function with mailbox limit guard"
```

---

### Prompt: Task 4 — getDrafts Multi-Status Support

```
You are implementing Task 4 of OutboundOS Phase 11: updating getDrafts to support multiple statuses.

**Files to modify:**
- src/features/drafts/server/get-drafts.ts
- src/features/drafts/server/get-drafts.test.ts

**Change:** Replace status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED' with statuses?: ('PENDING_REVIEW' | 'APPROVED' | 'REJECTED')[].
Default: ['PENDING_REVIEW', 'APPROVED'].
Prisma where clause: { organizationId, status: { in: statuses } }

**Test changes:**
- Rename "defaults to PENDING_REVIEW status" → "defaults to PENDING_REVIEW and APPROVED statuses"
- Update the assertion to: where: expect.objectContaining({ status: { in: ['PENDING_REVIEW', 'APPROVED'] } })
- Add test "uses provided statuses array": calls with statuses: ['APPROVED'], asserts where contains status: { in: ['APPROVED'] }

Write failing tests first, implement, run tests pass, commit: "feat: getDrafts supports multiple statuses, default PENDING_REVIEW + APPROVED"
```

---

### Prompt: Task 5 — POST /api/drafts/[id]/send Route Handler

```
You are implementing Task 5 of OutboundOS Phase 11: the POST /api/drafts/[id]/send route handler.

**Context:**
- Next.js 16: dynamic params are Promise<{ id: string }> — must await params
- Clerk v7: auth() → { orgId, userId } — check BOTH
- Route is thin: auth, await params, call sendDraft, handle errors
- No request body needed — draftId comes from the URL

**File:** src/app/api/drafts/[id]/send/route.ts

**Error mappings:**
- DraftNotFoundError → 404 { error: 'Draft not found' }
- DraftNotApprovedError → 409 { code: 'DRAFT_NOT_APPROVED', currentStatus, message }
- DraftAlreadySentError → 409 { code: 'DRAFT_ALREADY_SENT', messageId, message }
- NoActiveMailboxError → 422 { code: 'NO_ACTIVE_MAILBOX', message }
- MailboxLimitExceededError → 429 { code: 'MAILBOX_LIMIT_EXCEEDED', message }
- Other → 500

**On success:** return 201 with OutboundMessageDTO

No unit tests. Run npx tsc --noEmit && npm test. Commit: "feat: add POST /api/drafts/[id]/send route handler"
```

---

### Prompt: Task 6 — UI: Send Action in DraftsTable and DraftsClient

```
You are implementing Task 6 of OutboundOS Phase 11: adding the Send action to the drafts page UI.

**Files to modify:**
- src/features/drafts/components/drafts-table.tsx
- src/app/(dashboard)/drafts/drafts-client.tsx

**DraftsTable changes:**
Add optional props to DraftsTableProps:
  onSend?: (draft: DraftWithLeadDTO) => Promise<void>
  sendingDraftId?: string | null

In the Actions cell, add after the existing Review button logic:
  {draft.status === 'APPROVED' && onSend && (
    <button
      onClick={() => void onSend(draft)}
      disabled={sendingDraftId === draft.id}
      aria-label={`Send draft to ${displayName}`}
      className="text-xs px-3 py-1 rounded bg-[#1e3a2e] hover:bg-[#166534] text-[#4ade80] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {sendingDraftId === draft.id ? 'Sending…' : 'Send'}
    </button>
  )}

Also update empty state text from "No drafts pending review" to "No drafts".

**DraftsClient changes:**
1. Add state: sendingDraftId: string | null, sendError: string | null
2. Change handleDraftReviewed:
   - APPROVED: update in list with prev.map (keep visible with new status badge)
   - REJECTED: filter out, decrement total
   - (Remove current behavior of always filtering out)
3. Add handleSend(draft: DraftWithLeadDTO):
   - setSendingDraftId(draft.id), setSendError(null)
   - const res = await fetch('/api/drafts/${draft.id}/send', { method: 'POST' })
   - const data = await res.json().catch(() => null)
   - setSendingDraftId(null)
   - if (!res.ok): show user-friendly error in sendError state based on data.code
     - MAILBOX_LIMIT_EXCEEDED → "Daily send limit reached. Try again tomorrow."
     - NO_ACTIVE_MAILBOX → "No active mailbox configured. Add a mailbox in Settings."
     - DRAFT_ALREADY_SENT → "This draft has already been sent."
     - other → "Failed to send — please try again."
     - return
   - if ok: filter draft out of list, decrement total
4. Show sendError in a red banner above the table (bg-[#2d0f0f] border-[#7f1d1d])
5. Update counter label from "X drafts pending review" to "X drafts"
6. Pass onSend={handleSend} and sendingDraftId={sendingDraftId} to DraftsTable

Run npx tsc --noEmit && npm test. Commit: "feat: add Send action for approved drafts in drafts page"
```
