# Draft Generation & Review — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship row-level AI draft generation with a human approval gate — "Generate Draft" on `/leads`, review drawer on `/leads`, and a dedicated `/drafts` queue page.

**Architecture:** Feature-oriented monolith. All business logic in `src/features/drafts/server/`. Route handlers are thin (parse → call → respond). AI calls go through `src/lib/ai/` abstraction — feature code never imports OpenAI directly. Duplicate-draft protection enforced inside a `$transaction` with the AI call placed outside.

**Tech Stack:** Next.js 16 App Router, Prisma v7 (string-literal enum values, `$transaction` callback form), Clerk v7 (`auth()` → `{ orgId, userId }`), Vitest v4, Tailwind CSS v4 (inline `bg-[#...]`), TypeScript strict + `noUncheckedIndexedAccess`

---

## File Map

```
src/lib/ai/
  provider.ts                    MODIFY — add EmailDraftInput, EmailDraftOutput, draftEmail
  openai.ts                      MODIFY — implement draftEmail
  index.ts                       MODIFY — re-export new types
  openai.test.ts                 MODIFY — add draftEmail describe block

src/features/drafts/
  types.ts                       CREATE — DraftDTO, DraftWithLeadDTO, error classes
  server/
    generate-draft.ts            CREATE
    generate-draft.test.ts       CREATE
    review-draft.ts              CREATE
    review-draft.test.ts         CREATE
    get-drafts.ts                CREATE
    get-drafts.test.ts           CREATE
  components/
    draft-review-drawer.tsx      CREATE
    drafts-table.tsx             CREATE

src/app/api/drafts/
  generate/route.ts              CREATE
  [id]/review/route.ts           CREATE

src/app/(dashboard)/
  drafts/
    page.tsx                     CREATE
    drafts-client.tsx            CREATE
  leads/
    leads-client.tsx             MODIFY
src/features/leads/components/
  leads-table.tsx                MODIFY

src/components/layout/
  sidebar.tsx                    MODIFY — add /drafts nav item
```

---

## Task 1: AI Provider Extension

**Files:**
- Modify: `src/lib/ai/provider.ts`
- Modify: `src/lib/ai/openai.ts`
- Modify: `src/lib/ai/index.ts`
- Test: `src/lib/ai/openai.test.ts`

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to the bottom of `src/lib/ai/openai.test.ts`:

```ts
describe('OpenAIProvider.draftEmail', () => {
  let provider: OpenAIProvider
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    provider = new OpenAIProvider('test-key', 'gpt-4o')
    const client = (OpenAI as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      chat: { completions: { create: ReturnType<typeof vi.fn> } }
    }
    mockCreate = client.chat.completions.create
  })

  it('returns subject and body from AI response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        { message: { content: JSON.stringify({ subject: 'Hello Jane', body: 'Hi Jane...' }) } },
      ],
    })

    const result = await provider.draftEmail(
      { id: 'lead-1', email: 'jane@acme.com', firstName: 'Jane', company: 'Acme' },
      'You are a sales email writer.',
    )

    expect(result).toEqual({ subject: 'Hello Jane', body: 'Hi Jane...' })
  })

  it('returns fallback subject and empty body on parse failure', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not valid json' } }],
    })

    const result = await provider.draftEmail(
      { id: 'lead-1', email: 'jane@acme.com' },
      'You are a sales email writer.',
    )

    expect(result.subject).toBe('Draft for jane@acme.com')
    expect(result.body).toBe('')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/lib/ai/openai.test.ts
```

Expected: FAIL — `provider.draftEmail is not a function`

- [ ] **Step 3: Add types to provider.ts**

Replace `src/lib/ai/provider.ts` entirely:

```ts
export interface LeadScoreInput {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  title?: string | null
}

export interface LeadScoreOutput {
  leadId: string
  score: number      // 0–100
  reason: string
}

export interface EmailDraftInput {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  title?: string | null
}

export interface EmailDraftOutput {
  subject: string
  body: string
}

export interface AIProvider {
  scoreLeads(
    leads: LeadScoreInput[],
    promptTemplate: string,
  ): Promise<LeadScoreOutput[]>

  draftEmail(
    lead: EmailDraftInput,
    promptTemplate: string,
  ): Promise<EmailDraftOutput>
}
```

- [ ] **Step 4: Implement draftEmail in openai.ts**

Add the `draftEmail` method inside the `OpenAIProvider` class, after `scoreLeads`:

```ts
async draftEmail(
  lead: EmailDraftInput,
  promptTemplate: string,
): Promise<EmailDraftOutput> {
  const leadContext = `Email: ${lead.email} | Name: ${[lead.firstName, lead.lastName].filter(Boolean).join(' ') || 'Unknown'} | Title: ${lead.title ?? 'Unknown'} | Company: ${lead.company ?? 'Unknown'}`

  const systemPrompt = `${promptTemplate}

Write a personalized outbound sales email for the lead below.
Return ONLY a JSON object: { "subject": "<subject line>", "body": "<email body>" }
No markdown, no explanation.`

  try {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: leadContext },
      ],
      temperature: 0.4,
    })

    const content = response.choices[0]?.message.content ?? ''
    const raw = JSON.parse(content) as { subject?: unknown; body?: unknown }
    if (typeof raw.subject !== 'string' || typeof raw.body !== 'string') {
      throw new SyntaxError('Expected { subject, body } strings')
    }
    return { subject: raw.subject, body: raw.body }
  } catch {
    return { subject: `Draft for ${lead.email}`, body: '' }
  }
}
```

Also add `EmailDraftInput` to the import line at the top of `openai.ts`:

```ts
import type { AIProvider, LeadScoreInput, LeadScoreOutput, EmailDraftInput } from './provider'
```

- [ ] **Step 5: Re-export new types from index.ts**

Replace `src/lib/ai/index.ts`:

```ts
export { getAIProvider } from './router'
export type {
  AIProvider,
  LeadScoreInput,
  LeadScoreOutput,
  EmailDraftInput,
  EmailDraftOutput,
} from './provider'
```

- [ ] **Step 6: Run tests to confirm they pass**

```bash
npx vitest run src/lib/ai/openai.test.ts
```

Expected: 4 PASS (2 existing + 2 new)

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/provider.ts src/lib/ai/openai.ts src/lib/ai/index.ts src/lib/ai/openai.test.ts
git commit -m "feat: add draftEmail to AIProvider interface and OpenAIProvider"
```

---

## Task 2: Draft Feature Types and Error Classes

**Files:**
- Create: `src/features/drafts/types.ts`

No automated tests — pure types and error class definitions.

- [ ] **Step 1: Create src/features/drafts/types.ts**

```ts
import type { Draft } from '@prisma/client'

export type DraftDTO = Pick<
  Draft,
  | 'id'
  | 'organizationId'
  | 'leadId'
  | 'subject'
  | 'body'
  | 'status'
  | 'promptTemplateId'
  | 'createdByClerkId'
  | 'approvedByClerkId'
  | 'approvedAt'
  | 'rejectedAt'
  | 'rejectionReason'
  | 'createdAt'
  | 'updatedAt'
>

export interface DraftWithLeadDTO extends DraftDTO {
  lead: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    company: string | null
  }
}

export class PendingDraftExistsError extends Error {
  constructor(public readonly draftId: string) {
    super('A pending draft already exists for this lead.')
    this.name = 'PendingDraftExistsError'
  }
}

export class DraftNotPendingError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`Draft is not pending review (status: ${currentStatus}).`)
    this.name = 'DraftNotPendingError'
  }
}

export class DraftNotFoundError extends Error {
  constructor() {
    super('Draft not found.')
    this.name = 'DraftNotFoundError'
  }
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: no errors in `src/features/drafts/types.ts`

- [ ] **Step 3: Commit**

```bash
git add src/features/drafts/types.ts
git commit -m "feat: add draft types and error classes"
```

---

## Task 3: generateDraft Server Function

**Files:**
- Create: `src/features/drafts/server/generate-draft.ts`
- Create: `src/features/drafts/server/generate-draft.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/drafts/server/generate-draft.test.ts`:

```ts
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
import { PendingDraftExistsError } from '../types'

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
  })

  it('throws if lead is not found', async () => {
    mockPrisma.lead.findFirst.mockResolvedValue(null)

    await expect(generateDraft(input)).rejects.toThrow('Lead not found')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/features/drafts/server/generate-draft.test.ts
```

Expected: FAIL — `Cannot find module './generate-draft'`

- [ ] **Step 3: Implement generate-draft.ts**

Create `src/features/drafts/server/generate-draft.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import type { DraftDTO } from '../types'
import { PendingDraftExistsError } from '../types'

const FALLBACK_DRAFT_PROMPT = `You are a personalized outbound sales email writer. Write a short, direct cold email for the lead provided. Be conversational and focus on value. Keep it under 150 words. Return only valid JSON.`

interface GenerateDraftInput {
  organizationId: string
  leadId: string
  clerkUserId: string
}

export async function generateDraft({
  organizationId,
  leadId,
  clerkUserId,
}: GenerateDraftInput): Promise<DraftDTO> {
  // Fetch lead — org-scoped; 404 if missing
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      title: true,
    },
  })

  if (!lead) {
    throw new Error('Lead not found')
  }

  // Fetch active EMAIL_DRAFT template; null = use fallback
  const template = await prisma.promptTemplate.findFirst({
    where: { organizationId, promptType: 'EMAIL_DRAFT', isActive: true },
  })

  const promptTemplateId = template?.id ?? null
  const prompt = template?.body ?? FALLBACK_DRAFT_PROMPT

  // AI call OUTSIDE the transaction to avoid long-running transactions
  const provider = getAIProvider()
  const aiResult = await provider.draftEmail(lead, prompt)

  // Transaction: check for duplicate PENDING_REVIEW draft, then create
  const draft = await prisma.$transaction(async (tx) => {
    const existing = await tx.draft.findFirst({
      where: { leadId, organizationId, status: 'PENDING_REVIEW' },
    })

    if (existing) {
      throw new PendingDraftExistsError(existing.id)
    }

    const created = await tx.draft.create({
      data: {
        organizationId,
        leadId,
        subject: aiResult.subject,
        body: aiResult.body,
        status: 'PENDING_REVIEW',
        promptTemplateId,
        createdByClerkId: clerkUserId,
      },
    })

    await tx.auditLog.create({
      data: {
        organizationId,
        actorClerkId: clerkUserId,
        action: 'draft.generated',
        entityType: 'Draft',
        entityId: created.id,
        metadata: { leadId, promptTemplateId },
      },
    })

    return created
  })

  return {
    id: draft.id,
    organizationId: draft.organizationId,
    leadId: draft.leadId,
    subject: draft.subject,
    body: draft.body,
    status: draft.status,
    promptTemplateId: draft.promptTemplateId,
    createdByClerkId: draft.createdByClerkId,
    approvedByClerkId: draft.approvedByClerkId,
    approvedAt: draft.approvedAt,
    rejectedAt: draft.rejectedAt,
    rejectionReason: draft.rejectionReason,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/features/drafts/server/generate-draft.test.ts
```

Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/drafts/server/generate-draft.ts src/features/drafts/server/generate-draft.test.ts
git commit -m "feat: add generateDraft server function with transaction-safe duplicate check"
```

---

## Task 4: reviewDraft Server Function

**Files:**
- Create: `src/features/drafts/server/review-draft.ts`
- Create: `src/features/drafts/server/review-draft.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/drafts/server/review-draft.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/features/drafts/server/review-draft.test.ts
```

Expected: FAIL — `Cannot find module './review-draft'`

- [ ] **Step 3: Implement review-draft.ts**

Create `src/features/drafts/server/review-draft.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type { DraftDTO } from '../types'
import { DraftNotFoundError, DraftNotPendingError } from '../types'

interface ReviewDraftInput {
  organizationId: string
  draftId: string
  clerkUserId: string
  action: 'approve' | 'reject'
  subject?: string
  body?: string
  rejectionReason?: string
}

export async function reviewDraft({
  organizationId,
  draftId,
  clerkUserId,
  action,
  subject,
  body,
  rejectionReason,
}: ReviewDraftInput): Promise<DraftDTO> {
  // Fetch draft — org-scoped (returns null for both not-found and wrong-org to avoid enumeration)
  const existing = await prisma.draft.findFirst({
    where: { id: draftId, organizationId },
  })

  if (!existing) {
    throw new DraftNotFoundError()
  }

  if (existing.status !== 'PENDING_REVIEW') {
    throw new DraftNotPendingError(existing.status)
  }

  const now = new Date()

  const updated = await prisma.$transaction(async (tx) => {
    let draft
    if (action === 'approve') {
      draft = await tx.draft.update({
        where: { id: draftId },
        data: {
          status: 'APPROVED',
          ...(subject !== undefined && { subject }),
          ...(body !== undefined && { body }),
          approvedByClerkId: clerkUserId,
          approvedAt: now,
        },
      })
    } else {
      draft = await tx.draft.update({
        where: { id: draftId },
        data: {
          status: 'REJECTED',
          rejectedAt: now,
          ...(rejectionReason !== undefined && { rejectionReason }),
        },
      })
    }

    await tx.auditLog.create({
      data: {
        organizationId,
        actorClerkId: clerkUserId,
        action: action === 'approve' ? 'draft.approved' : 'draft.rejected',
        entityType: 'Draft',
        entityId: draftId,
        metadata:
          action === 'approve'
            ? { leadId: existing.leadId, edited: subject !== undefined || body !== undefined }
            : { leadId: existing.leadId, rejectionReason: rejectionReason ?? null },
      },
    })

    return draft
  })

  return {
    id: updated.id,
    organizationId: updated.organizationId,
    leadId: updated.leadId,
    subject: updated.subject,
    body: updated.body,
    status: updated.status,
    promptTemplateId: updated.promptTemplateId,
    createdByClerkId: updated.createdByClerkId,
    approvedByClerkId: updated.approvedByClerkId,
    approvedAt: updated.approvedAt,
    rejectedAt: updated.rejectedAt,
    rejectionReason: updated.rejectionReason,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/features/drafts/server/review-draft.test.ts
```

Expected: 5 PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/drafts/server/review-draft.ts src/features/drafts/server/review-draft.test.ts
git commit -m "feat: add reviewDraft server function with audit logging"
```

---

## Task 5: getDrafts Server Function

**Files:**
- Create: `src/features/drafts/server/get-drafts.ts`
- Create: `src/features/drafts/server/get-drafts.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/features/drafts/server/get-drafts.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    draft: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getDrafts } from './get-drafts'

const mockPrisma = prisma as unknown as {
  draft: {
    findMany: ReturnType<typeof vi.fn>
    count: ReturnType<typeof vi.fn>
  }
}

beforeEach(() => vi.clearAllMocks())

const fakeDraftWithLead = {
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
  lead: {
    id: 'lead-1',
    email: 'jane@acme.com',
    firstName: 'Jane',
    lastName: 'Doe',
    company: 'Acme',
  },
}

describe('getDrafts', () => {
  it('returns drafts with lead data and total count', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([fakeDraftWithLead])
    mockPrisma.draft.count.mockResolvedValue(1)

    const result = await getDrafts({ organizationId: 'org-1' })

    expect(result.total).toBe(1)
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0]?.lead.email).toBe('jane@acme.com')
    expect(result.drafts[0]?.subject).toBe('Hello Jane')
  })

  it('defaults to PENDING_REVIEW status', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([])
    mockPrisma.draft.count.mockResolvedValue(0)

    await getDrafts({ organizationId: 'org-1' })

    expect(mockPrisma.draft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING_REVIEW' }),
      }),
    )
  })

  it('caps limit at 200', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([])
    mockPrisma.draft.count.mockResolvedValue(0)

    await getDrafts({ organizationId: 'org-1', limit: 9999 })

    expect(mockPrisma.draft.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 200 }),
    )
  })

  it('returns empty list when no drafts exist', async () => {
    mockPrisma.draft.findMany.mockResolvedValue([])
    mockPrisma.draft.count.mockResolvedValue(0)

    const result = await getDrafts({ organizationId: 'org-1' })

    expect(result.drafts).toEqual([])
    expect(result.total).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run src/features/drafts/server/get-drafts.test.ts
```

Expected: FAIL — `Cannot find module './get-drafts'`

- [ ] **Step 3: Implement get-drafts.ts**

Create `src/features/drafts/server/get-drafts.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type { DraftWithLeadDTO } from '../types'

interface GetDraftsInput {
  organizationId: string
  status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  limit?: number
  offset?: number
}

export async function getDrafts({
  organizationId,
  status = 'PENDING_REVIEW',
  limit = 50,
  offset = 0,
}: GetDraftsInput): Promise<{ drafts: DraftWithLeadDTO[]; total: number }> {
  const cappedLimit = Math.min(limit, 200)

  const [rows, total] = await Promise.all([
    prisma.draft.findMany({
      where: { organizationId, status },
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
    prisma.draft.count({ where: { organizationId, status } }),
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

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run src/features/drafts/server/get-drafts.test.ts
```

Expected: 4 PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/drafts/server/get-drafts.ts src/features/drafts/server/get-drafts.test.ts
git commit -m "feat: add getDrafts server function"
```

---

## Task 6: API Route Handlers

**Files:**
- Create: `src/app/api/drafts/generate/route.ts`
- Create: `src/app/api/drafts/[id]/review/route.ts`

No unit tests — route handlers are thin wrappers over already-tested server functions.

- [ ] **Step 1: Create POST /api/drafts/generate**

Create `src/app/api/drafts/generate/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { generateDraft } from '@/features/drafts/server/generate-draft'
import { PendingDraftExistsError } from '@/features/drafts/types'

export async function POST(request: Request) {
  const { orgId, userId } = await auth()

  if (!orgId || !userId) {
    return NextResponse.json(
      { error: 'No active organization. Select an organization to continue.' },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('leadId' in body) ||
    typeof (body as { leadId: unknown }).leadId !== 'string'
  ) {
    return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
  }

  const { leadId } = body as { leadId: string }

  try {
    const draft = await generateDraft({ organizationId: orgId, leadId, clerkUserId: userId })
    return NextResponse.json(draft)
  } catch (err) {
    if (err instanceof PendingDraftExistsError) {
      return NextResponse.json(
        {
          code: 'PENDING_DRAFT_EXISTS',
          draftId: err.draftId,
          message: err.message,
        },
        { status: 409 },
      )
    }
    if (err instanceof Error && err.message === 'Lead not found') {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }
    console.error('[POST /api/drafts/generate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Create PATCH /api/drafts/[id]/review**

Create `src/app/api/drafts/[id]/review/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { reviewDraft } from '@/features/drafts/server/review-draft'
import { DraftNotFoundError, DraftNotPendingError } from '@/features/drafts/types'

export async function PATCH(
  request: Request,
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const {
    action,
    subject,
    body: emailBody,
    rejectionReason,
  } = body as {
    action?: unknown
    subject?: unknown
    body?: unknown
    rejectionReason?: unknown
  }

  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { error: 'action must be "approve" or "reject"' },
      { status: 400 },
    )
  }

  try {
    const draft = await reviewDraft({
      organizationId: orgId,
      draftId,
      clerkUserId: userId,
      action,
      ...(typeof subject === 'string' && { subject }),
      ...(typeof emailBody === 'string' && { body: emailBody }),
      ...(typeof rejectionReason === 'string' && { rejectionReason }),
    })
    return NextResponse.json(draft)
  } catch (err) {
    if (err instanceof DraftNotFoundError) {
      return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    }
    if (err instanceof DraftNotPendingError) {
      return NextResponse.json(
        {
          code: 'DRAFT_NOT_PENDING',
          currentStatus: err.currentStatus,
          message: err.message,
        },
        { status: 409 },
      )
    }
    console.error('[PATCH /api/drafts/[id]/review]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: no errors in the new route files

- [ ] **Step 4: Commit**

```bash
git add src/app/api/drafts/generate/route.ts src/app/api/drafts/[id]/review/route.ts
git commit -m "feat: add draft API route handlers (generate + review)"
```

---

## Task 7: DraftReviewDrawer Component

**Files:**
- Create: `src/features/drafts/components/draft-review-drawer.tsx`

> **Note:** The spec defines `draftId: string | null` in `DraftReviewDrawerProps`. This implementation uses `draft: DraftDTO | null` instead — the parent always has the full DTO from the generation response or the drafts list, so passing the object directly avoids an extra GET request and keeps the interface simpler.

- [ ] **Step 1: Create draft-review-drawer.tsx**

Create `src/features/drafts/components/draft-review-drawer.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import type { DraftDTO } from '../types'

interface DraftReviewDrawerProps {
  draft: DraftDTO | null  // null = closed
  onClose: () => void
  onReviewed: (draft: DraftDTO) => void
}

export function DraftReviewDrawer({ draft, onClose, onReviewed }: DraftReviewDrawerProps) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form state when a new draft is opened
  useEffect(() => {
    if (draft) {
      setSubject(draft.subject)
      setBody(draft.body)
      setShowRejectInput(false)
      setRejectionReason('')
      setError(null)
    }
  }, [draft?.id])

  if (!draft) return null

  async function handleApprove() {
    if (!draft) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/drafts/${draft.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          subject: subject !== draft.subject ? subject : undefined,
          body: body !== draft.body ? body : undefined,
        }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string }
        setError(data.message ?? data.error ?? 'Failed to approve draft')
        return
      }
      const updated = (await res.json()) as DraftDTO
      onReviewed(updated)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReject() {
    if (!draft) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/drafts/${draft.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          rejectionReason: rejectionReason || undefined,
        }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string }
        setError(data.message ?? data.error ?? 'Failed to reject draft')
        return
      }
      const updated = (await res.json()) as DraftDTO
      onReviewed(updated)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-[#13151c] border-l border-[#1e2130] z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#1e2130]">
          <h2 className="text-[#e2e8f0] font-semibold">Review Draft</h2>
          <button
            onClick={onClose}
            className="text-[#475569] hover:text-[#94a3b8] transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-[#475569] text-xs font-medium uppercase tracking-wide mb-1">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-[#1a1d2e] border border-[#1e2130] rounded px-3 py-2 text-[#e2e8f0] text-sm focus:outline-none focus:border-[#6366f1]"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-[#475569] text-xs font-medium uppercase tracking-wide mb-1">
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              className="w-full bg-[#1a1d2e] border border-[#1e2130] rounded px-3 py-2 text-[#e2e8f0] text-sm focus:outline-none focus:border-[#6366f1] resize-none"
              disabled={submitting}
            />
          </div>

          {showRejectInput && (
            <div>
              <label className="block text-[#475569] text-xs font-medium uppercase tracking-wide mb-1">
                Rejection reason (optional)
              </label>
              <input
                type="text"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Wrong tone, needs revision"
                className="w-full bg-[#1a1d2e] border border-[#1e2130] rounded px-3 py-2 text-[#e2e8f0] text-sm focus:outline-none focus:border-[#6366f1]"
                disabled={submitting}
              />
            </div>
          )}

          {error && <p className="text-[#ef4444] text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#1e2130] flex gap-2">
          {!showRejectInput ? (
            <>
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="flex-1 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium transition-colors"
              >
                {submitting ? 'Approving…' : 'Approve'}
              </button>
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-[#ef4444] border border-[#ef4444]/40 rounded hover:bg-[#ef4444]/10 disabled:opacity-50 transition-colors"
              >
                Reject
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleReject}
                disabled={submitting}
                className="flex-1 bg-[#ef4444] hover:bg-[#dc2626] disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium transition-colors"
              >
                {submitting ? 'Rejecting…' : 'Confirm Reject'}
              </button>
              <button
                onClick={() => setShowRejectInput(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-[#475569] border border-[#1e2130] rounded hover:bg-[#1a1d2e] disabled:opacity-50 transition-colors"
              >
                Back
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: no errors in `draft-review-drawer.tsx`

- [ ] **Step 3: Commit**

```bash
git add src/features/drafts/components/draft-review-drawer.tsx
git commit -m "feat: add DraftReviewDrawer component with approve/reject flow"
```

---

## Task 8: Leads Page Integration

**Files:**
- Modify: `src/features/leads/components/leads-table.tsx`
- Modify: `src/app/(dashboard)/leads/leads-client.tsx`

- [ ] **Step 1: Modify leads-table.tsx to support optional Actions column**

Replace `src/features/leads/components/leads-table.tsx` with:

```tsx
import { Badge } from '@/components/ui/badge'
import type { LeadDTO } from '../types'

interface LeadsTableProps {
  leads: LeadDTO[]
  pendingDrafts?: Map<string, string>   // leadId → draftId
  onGenerateDraft?: (leadId: string) => Promise<void>
  onReviewDraft?: (leadId: string) => void
  generatingLeadId?: string | null
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-[#475569] text-xs">—</span>
  const variant = score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger'
  return <Badge variant={variant}>{score}</Badge>
}

function StatusBadge({ status }: { status: LeadDTO['status'] }) {
  const variantMap: Record<LeadDTO['status'], 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
    NEW: 'default',
    CONTACTED: 'warning',
    REPLIED: 'success',
    BOUNCED: 'danger',
    UNSUBSCRIBED: 'danger',
    CONVERTED: 'success',
  }
  return <Badge variant={variantMap[status]}>{status}</Badge>
}

export function LeadsTable({
  leads,
  pendingDrafts,
  onGenerateDraft,
  onReviewDraft,
  generatingLeadId,
}: LeadsTableProps) {
  const showActions = !!onGenerateDraft

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[#475569] text-sm">No leads yet.</p>
        <p className="text-[#334155] text-xs mt-1">Import a CSV to get started.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e2130]">
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Name</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Company</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Title</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Score</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Score Reason</th>
            {showActions && (
              <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const hasPendingDraft = pendingDrafts?.has(lead.id) ?? false
            const isGenerating = generatingLeadId === lead.id

            return (
              <tr
                key={lead.id}
                className="border-b border-[#1a1d2e] hover:bg-[#1a1d2e] transition-colors"
              >
                <td className="py-3 px-4">
                  <div className="text-[#e2e8f0] font-medium">
                    {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'}
                  </div>
                  <div className="text-[#475569] text-xs">{lead.email}</div>
                </td>
                <td className="py-3 px-4 text-[#94a3b8]">{lead.company ?? '—'}</td>
                <td className="py-3 px-4 text-[#94a3b8]">{lead.title ?? '—'}</td>
                <td className="py-3 px-4"><StatusBadge status={lead.status} /></td>
                <td className="py-3 px-4"><ScoreBadge score={lead.score} /></td>
                <td className="py-3 px-4 text-[#475569] text-xs hidden lg:table-cell max-w-xs truncate">
                  {lead.scoreReason ?? '—'}
                </td>
                {showActions && (
                  <td className="py-3 px-4">
                    {hasPendingDraft ? (
                      <button
                        onClick={() => onReviewDraft?.(lead.id)}
                        className="text-xs text-[#6366f1] hover:text-[#818cf8] transition-colors font-medium"
                      >
                        Review Draft
                      </button>
                    ) : (
                      <button
                        onClick={() => void onGenerateDraft?.(lead.id)}
                        disabled={isGenerating}
                        className="text-xs text-[#475569] hover:text-[#94a3b8] disabled:opacity-50 transition-colors"
                      >
                        {isGenerating ? 'Generating…' : 'Generate Draft'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Modify leads-client.tsx to wire up draft generation and review**

Replace `src/app/(dashboard)/leads/leads-client.tsx` with:

```tsx
'use client'

import { useState } from 'react'
import { CsvUploadForm } from '@/features/leads/components/csv-upload-form'
import { LeadsTable } from '@/features/leads/components/leads-table'
import { DraftReviewDrawer } from '@/features/drafts/components/draft-review-drawer'
import type { LeadDTO, ImportBatchResult } from '@/features/leads/types'
import type { DraftDTO } from '@/features/drafts/types'

interface LeadsPageClientProps {
  initialLeads: LeadDTO[]
  initialTotal: number
}

export function LeadsPageClient({ initialLeads, initialTotal }: LeadsPageClientProps) {
  const [leads, setLeads] = useState<LeadDTO[]>(initialLeads)
  const [total, setTotal] = useState(initialTotal)
  const [lastBatch, setLastBatch] = useState<ImportBatchResult['batch'] | null>(null)

  // Draft state: map of leadId → DraftDTO for leads with a pending draft
  const [draftsByLeadId, setDraftsByLeadId] = useState<Map<string, DraftDTO>>(new Map())
  const [reviewingDraft, setReviewingDraft] = useState<DraftDTO | null>(null)
  const [generatingLeadId, setGeneratingLeadId] = useState<string | null>(null)

  // pendingDrafts: leadId → draftId (passed to table for display logic)
  const pendingDrafts = new Map(
    [...draftsByLeadId.entries()]
      .filter(([, d]) => d.status === 'PENDING_REVIEW')
      .map(([leadId, d]) => [leadId, d.id]),
  )

  function handleImportSuccess(result: ImportBatchResult) {
    setLeads((prev) => {
      const existingIds = new Set(prev.map((l) => l.id))
      const newLeads = result.leads.filter((l) => !existingIds.has(l.id))
      return [...newLeads, ...prev]
    })
    setTotal((prev) => prev + result.batch.successCount)
    setLastBatch(result.batch)
  }

  async function handleGenerateDraft(leadId: string) {
    setGeneratingLeadId(leadId)
    try {
      const res = await fetch('/api/drafts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })

      const data = (await res.json()) as
        | DraftDTO
        | { code: string; draftId: string; message: string }

      if (res.status === 409 && 'code' in data && data.code === 'PENDING_DRAFT_EXISTS') {
        // Duplicate — mark in map (we don't have the full DTO, so just mark leadId → draftId)
        // The user can navigate to /drafts to review it
        setDraftsByLeadId((prev) => {
          const next = new Map(prev)
          // Create a minimal placeholder so the "Review Draft" button appears
          next.set(leadId, {
            id: data.draftId,
            organizationId: '',
            leadId,
            subject: '',
            body: '',
            status: 'PENDING_REVIEW',
            promptTemplateId: null,
            createdByClerkId: null,
            approvedByClerkId: null,
            approvedAt: null,
            rejectedAt: null,
            rejectionReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as DraftDTO)
          return next
        })
        return
      }

      if (!res.ok) return

      const draft = data as DraftDTO
      setDraftsByLeadId((prev) => new Map(prev).set(leadId, draft))
      setReviewingDraft(draft)
    } finally {
      setGeneratingLeadId(null)
    }
  }

  function handleReviewDraft(leadId: string) {
    const draft = draftsByLeadId.get(leadId)
    if (draft) setReviewingDraft(draft)
  }

  function handleDraftReviewed(updatedDraft: DraftDTO) {
    // Remove from pendingDrafts map (it's no longer PENDING_REVIEW)
    setDraftsByLeadId((prev) => {
      const next = new Map(prev)
      next.set(updatedDraft.leadId, updatedDraft)
      return next
    })
    setReviewingDraft(null)
  }

  return (
    <>
      <div className="space-y-6">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[#94a3b8] text-sm">
              {total.toLocaleString()} lead{total !== 1 ? 's' : ''}
            </span>
            {lastBatch && (
              <span className="text-[#10b981] text-xs">
                + {lastBatch.successCount} imported
              </span>
            )}
          </div>
          <CsvUploadForm onSuccess={handleImportSuccess} />
        </div>

        {/* Table */}
        <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
          <LeadsTable
            leads={leads}
            pendingDrafts={pendingDrafts}
            onGenerateDraft={handleGenerateDraft}
            onReviewDraft={handleReviewDraft}
            generatingLeadId={generatingLeadId}
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

- [ ] **Step 3: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: no errors in modified files

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/components/leads-table.tsx src/app/(dashboard)/leads/leads-client.tsx
git commit -m "feat: add Generate Draft / Review Draft actions to leads table"
```

---

## Task 9: Drafts Page, DraftsTable, and Sidebar

**Files:**
- Create: `src/features/drafts/components/drafts-table.tsx`
- Create: `src/app/(dashboard)/drafts/page.tsx`
- Create: `src/app/(dashboard)/drafts/drafts-client.tsx`
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Create DraftsTable component**

Create `src/features/drafts/components/drafts-table.tsx`:

```tsx
import { Badge } from '@/components/ui/badge'
import type { DraftWithLeadDTO } from '../types'

interface DraftsTableProps {
  drafts: DraftWithLeadDTO[]
  onReview: (draft: DraftWithLeadDTO) => void
}

function DraftStatusBadge({ status }: { status: DraftWithLeadDTO['status'] }) {
  const variantMap: Record<string, 'default' | 'warning' | 'success' | 'danger'> = {
    PENDING_REVIEW: 'warning',
    APPROVED: 'success',
    REJECTED: 'danger',
  }
  const variant = variantMap[status as string] ?? 'default'
  const label = status === 'PENDING_REVIEW' ? 'Pending' : status === 'APPROVED' ? 'Approved' : 'Rejected'
  return <Badge variant={variant}>{label}</Badge>
}

export function DraftsTable({ drafts, onReview }: DraftsTableProps) {
  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[#475569] text-sm">No drafts pending review.</p>
        <p className="text-[#334155] text-xs mt-1">
          Generate drafts from the Leads page to get started.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e2130]">
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">
              Lead
            </th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">
              Subject
            </th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">
              Status
            </th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">
              Created
            </th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">
              Actions
            </th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => (
            <tr
              key={draft.id}
              className="border-b border-[#1a1d2e] hover:bg-[#1a1d2e] transition-colors"
            >
              <td className="py-3 px-4">
                <div className="text-[#e2e8f0] font-medium">
                  {[draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') || '—'}
                </div>
                <div className="text-[#475569] text-xs">{draft.lead.email}</div>
              </td>
              <td className="py-3 px-4 text-[#94a3b8] max-w-xs truncate">
                {draft.subject || <span className="text-[#475569]">—</span>}
              </td>
              <td className="py-3 px-4">
                <DraftStatusBadge status={draft.status} />
              </td>
              <td className="py-3 px-4 text-[#475569] text-xs hidden lg:table-cell">
                {new Date(draft.createdAt).toLocaleDateString()}
              </td>
              <td className="py-3 px-4">
                {draft.status === 'PENDING_REVIEW' && (
                  <button
                    onClick={() => onReview(draft)}
                    className="text-xs text-[#6366f1] hover:text-[#818cf8] transition-colors font-medium"
                  >
                    Review
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Create DraftsClient**

Create `src/app/(dashboard)/drafts/drafts-client.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { DraftsTable } from '@/features/drafts/components/drafts-table'
import { DraftReviewDrawer } from '@/features/drafts/components/draft-review-drawer'
import type { DraftWithLeadDTO } from '@/features/drafts/types'
import type { DraftDTO } from '@/features/drafts/types'

interface DraftsClientProps {
  initialDrafts: DraftWithLeadDTO[]
  initialTotal: number
}

export function DraftsClient({ initialDrafts, initialTotal }: DraftsClientProps) {
  const [drafts, setDrafts] = useState<DraftWithLeadDTO[]>(initialDrafts)
  const [total, setTotal] = useState(initialTotal)
  const [reviewingDraft, setReviewingDraft] = useState<DraftDTO | null>(null)

  function handleReview(draft: DraftWithLeadDTO) {
    setReviewingDraft(draft)
  }

  function handleDraftReviewed(updatedDraft: DraftDTO) {
    // Remove the reviewed draft from the pending list
    setDrafts((prev) => prev.filter((d) => d.id !== updatedDraft.id))
    setTotal((prev) => Math.max(0, prev - 1))
    setReviewingDraft(null)
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <span className="text-[#94a3b8] text-sm">
            {total.toLocaleString()} draft{total !== 1 ? 's' : ''} pending review
          </span>
        </div>

        <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
          <DraftsTable drafts={drafts} onReview={handleReview} />
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

- [ ] **Step 3: Create the /drafts server page**

Create `src/app/(dashboard)/drafts/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { DraftsClient } from './drafts-client'
import { getDrafts } from '@/features/drafts/server/get-drafts'

export default async function DraftsPage() {
  const { orgId } = await auth()
  if (!orgId) redirect('/dashboard')

  const { drafts, total } = await getDrafts({ organizationId: orgId })

  return (
    <>
      <Header title="Drafts" />
      <div className="flex-1 p-6">
        <DraftsClient initialDrafts={drafts} initialTotal={total} />
      </div>
    </>
  )
}
```

- [ ] **Step 4: Add /drafts to the sidebar**

In `src/components/layout/sidebar.tsx`, add the `Mail` icon to the import and add a `/drafts` nav item:

```ts
import {
  LayoutDashboard,
  Users,
  Megaphone,
  GitBranch,
  Inbox,
  BarChart2,
  FileText,
  Mail,
  Settings,
} from 'lucide-react'
```

Add to `NAV_ITEMS` array after `/leads`:

```ts
{ href: '/drafts', icon: Mail, label: 'Drafts' },
```

Full updated `NAV_ITEMS`:

```ts
const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/drafts', icon: Mail, label: 'Drafts' },
  { href: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { href: '/sequences', icon: GitBranch, label: 'Sequences' },
  { href: '/inbox', icon: Inbox, label: 'Inbox' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/templates', icon: FileText, label: 'Templates' },
] as const
```

- [ ] **Step 5: Verify TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/features/drafts/components/drafts-table.tsx src/app/(dashboard)/drafts/page.tsx src/app/(dashboard)/drafts/drafts-client.tsx src/components/layout/sidebar.tsx
git commit -m "feat: add /drafts review queue page and sidebar navigation"
```

---

## Copy-Paste Prompts

Use these when dispatching subagents for each task.

---

### Prompt: Task 1 — AI Provider Extension

```
You are implementing Task 1 of the OutboundOS Phase 10 feature: Draft Generation & Review.

**Context:**
- Feature-oriented monolith, Next.js 16, TypeScript strict + noUncheckedIndexedAccess
- Vitest v4 for tests. Mock pattern: vi.fn().mockImplementation(function() {...}) for constructors (not arrows). Extract mockCreate from `(OpenAI as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value`
- AI calls always go through the getAIProvider() abstraction — never import OpenAI directly in feature code

**Your task:** Add `draftEmail` to the AIProvider interface and implement it in OpenAIProvider. Temperature 0.4, parse JSON `{ subject, body }`. On any failure, return `{ subject: 'Draft for <email>', body: '' }` — always create the Draft record.

**Files to modify:**
- `src/lib/ai/provider.ts` — add EmailDraftInput, EmailDraftOutput interfaces and draftEmail method to AIProvider
- `src/lib/ai/openai.ts` — implement draftEmail
- `src/lib/ai/index.ts` — re-export EmailDraftInput, EmailDraftOutput
- `src/lib/ai/openai.test.ts` — ADD a new describe block for draftEmail (do not replace existing tests)

Follow TDD: write tests first, run to confirm failure, implement, run to confirm pass, commit.
```

---

### Prompt: Task 2 — Draft Types and Error Classes

```
You are implementing Task 2 of OutboundOS Phase 10: Draft types and error classes.

**Context:**
- Prisma v7, TypeScript strict. DraftStatus enum values in Prisma are usable as string literals in this codebase (existing code uses 'PROCESSING', 'COMPLETED', etc. as strings in Prisma where clauses).
- The Draft model fields are defined in prisma/schema.prisma.

**Your task:** Create `src/features/drafts/types.ts` with:
- `DraftDTO` — Pick from Prisma's Draft model
- `DraftWithLeadDTO extends DraftDTO` — adds a lead object
- `PendingDraftExistsError` — carries draftId: string
- `DraftNotPendingError` — carries currentStatus: string
- `DraftNotFoundError`

No automated tests needed. After creating, run `npx tsc --noEmit` to confirm no errors, then commit.
```

---

### Prompt: Task 3 — generateDraft Server Function

```
You are implementing Task 3 of OutboundOS Phase 10: the generateDraft server function.

**Context:**
- All business logic lives in src/features/drafts/server/
- Route handlers are thin; all logic here
- Prisma $transaction uses callback form: prisma.$transaction(async (tx) => { ... })
- AI call goes OUTSIDE the transaction (avoid long-running transactions)
- noUncheckedIndexedAccess: array[0] returns T | undefined, use optional chaining

**Key behaviors:**
1. Fetch lead (org-scoped, throw Error('Lead not found') if missing)
2. Fetch active EMAIL_DRAFT PromptTemplate — if none, use built-in fallback prompt; promptTemplateId is null when fallback is used
3. Call getAIProvider().draftEmail(lead, prompt) OUTSIDE the transaction
4. Inside $transaction: findFirst for PENDING_REVIEW draft → if found throw PendingDraftExistsError(existing.id) → else create Draft + AuditLog

**AuditLog:** action='draft.generated', entityType='Draft', entityId=created.id, metadata={ leadId, promptTemplateId }

**DraftDTO shape:** id, organizationId, leadId, subject, body, status, promptTemplateId, createdByClerkId, approvedByClerkId, approvedAt, rejectedAt, rejectionReason, createdAt, updatedAt

**Mock pattern for $transaction in tests:**
```ts
mockPrisma.$transaction.mockImplementationOnce(
  async (fn: (tx: unknown) => Promise<unknown>) => {
    const mockTx = {
      draft: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue(fakeDraft) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }
    return fn(mockTx)
  },
)
```

Follow TDD. Files: src/features/drafts/server/generate-draft.ts + generate-draft.test.ts
```

---

### Prompt: Task 4 — reviewDraft Server Function

```
You are implementing Task 4 of OutboundOS Phase 10: the reviewDraft server function.

**Context:**
- src/features/drafts/server/review-draft.ts
- Prisma $transaction callback form
- Error classes are in src/features/drafts/types.ts

**Key behaviors:**
1. findFirst with { id: draftId, organizationId } — returns null for both not-found AND wrong-org (security: no enumeration)
2. If null → throw DraftNotFoundError
3. If existing.status !== 'PENDING_REVIEW' → throw DraftNotPendingError(existing.status)
4. Inside $transaction:
   - approve: update draft (status=APPROVED, optional subject/body edits, approvedByClerkId, approvedAt)
   - reject: update draft (status=REJECTED, rejectedAt, optional rejectionReason)
   - Write AuditLog (draft.approved or draft.rejected)
5. Return updated DraftDTO

**AuditLog metadata:**
- approve: { leadId, edited: boolean } (edited = subject or body was provided)
- reject: { leadId, rejectionReason: string | null }

Follow TDD. Files: src/features/drafts/server/review-draft.ts + review-draft.test.ts
```

---

### Prompt: Task 5 — getDrafts Server Function

```
You are implementing Task 5 of OutboundOS Phase 10: the getDrafts server function.

**Context:**
- src/features/drafts/server/get-drafts.ts
- Called directly from /drafts server component (no GET API route)
- Returns DraftWithLeadDTO[] with included lead data

**Key behaviors:**
1. Default status = 'PENDING_REVIEW', limit = 50, offset = 0
2. Cap limit at 200
3. Use Promise.all for findMany + count (parallel queries)
4. Include lead: { id, email, firstName, lastName, company }
5. Order by createdAt desc
6. Return { drafts: DraftWithLeadDTO[], total: number }

Follow TDD. Files: src/features/drafts/server/get-drafts.ts + get-drafts.test.ts
```

---

### Prompt: Task 6 — API Route Handlers

```
You are implementing Task 6 of OutboundOS Phase 10: API route handlers.

**Context:**
- Next.js 16: dynamic route params are Promise<{ id: string }> — must await params
- Clerk v7: auth() → { orgId, userId } — check BOTH
- Route handlers are thin: parse → call server function → handle errors

**POST /api/drafts/generate** (src/app/api/drafts/generate/route.ts):
- Body: { leadId: string }
- Call generateDraft({ organizationId: orgId, leadId, clerkUserId: userId })
- On PendingDraftExistsError → 409 { code: 'PENDING_DRAFT_EXISTS', draftId, message }
- On Error('Lead not found') → 404
- On success → 200 DraftDTO

**PATCH /api/drafts/[id]/review** (src/app/api/drafts/[id]/review/route.ts):
- Body: { action: 'approve'|'reject', subject?, body?, rejectionReason? }
- Validate action is 'approve' or 'reject' → 400 if invalid
- Call reviewDraft(...)
- On DraftNotFoundError → 404
- On DraftNotPendingError → 409 { code: 'DRAFT_NOT_PENDING', currentStatus, message }
- On success → 200 DraftDTO

No unit tests needed for route handlers. Run npx tsc --noEmit to check, then commit.
```

---

### Prompt: Task 7 — DraftReviewDrawer Component

```
You are implementing Task 7 of OutboundOS Phase 10: the DraftReviewDrawer component.

**Context:**
- Tailwind CSS v4: use inline color values bg-[#13151c], no tailwind.config.js
- Dark theme palette: background #13151c, borders #1e2130, row hover #1a1d2e, text #e2e8f0, muted #94a3b8, subtle #475569, accent #6366f1, danger #ef4444
- 'use client' component (uses useState, useEffect, fetch)

**Props:** (note: spec had draftId; we use full draft object to avoid extra GET)
```ts
interface DraftReviewDrawerProps {
  draft: DraftDTO | null  // null = closed
  onClose: () => void
  onReviewed: (draft: DraftDTO) => void
}
```

**Behavior:**
- null → render nothing
- On open (draft?.id changes): reset form to draft.subject/draft.body
- Editable subject input + body textarea pre-filled with AI content
- Approve button: sends PATCH with edited values (only send subject/body if changed from original)
- Reject button: shows optional rejectionReason input, then Confirm Reject / Back buttons
- Right-side drawer with dark backdrop (click backdrop to close)
- Loading state during submit, error display on failure

File: src/features/drafts/components/draft-review-drawer.tsx
Run npx tsc --noEmit, then commit.
```

---

### Prompt: Task 8 — Leads Page Integration

```
You are implementing Task 8 of OutboundOS Phase 10: wiring draft generation into the leads page.

**Files to modify:**
- src/features/leads/components/leads-table.tsx
- src/app/(dashboard)/leads/leads-client.tsx

**LeadsTable changes:**
Add optional props:
```ts
pendingDrafts?: Map<string, string>   // leadId → draftId
onGenerateDraft?: (leadId: string) => Promise<void>
onReviewDraft?: (leadId: string) => void
generatingLeadId?: string | null
```
When onGenerateDraft is present, add an "Actions" column (last column). Per row: if leadId in pendingDrafts → "Review Draft" button (calls onReviewDraft); else → "Generate Draft" button (calls onGenerateDraft, disabled while generatingLeadId === lead.id). No Actions column when onGenerateDraft is absent (preserve existing behavior).

**leads-client.tsx changes:**
Add state:
- `draftsByLeadId: Map<string, DraftDTO>` — leadId → DraftDTO for all generated drafts this session
- `reviewingDraft: DraftDTO | null` — draft currently open in drawer
- `generatingLeadId: string | null`
- Compute `pendingDrafts` (Map<string, string>) from draftsByLeadId filtered to PENDING_REVIEW

handleGenerateDraft(leadId):
- POST /api/drafts/generate
- 409 PENDING_DRAFT_EXISTS → store minimal placeholder DraftDTO in map (so Review button appears)
- success → store full DraftDTO in map, open drawer

handleReviewDraft(leadId): look up DraftDTO from map, set as reviewingDraft

handleDraftReviewed(updatedDraft): update map, close drawer

Mount DraftReviewDrawer with reviewingDraft, onClose, onReviewed.

Run npm test after, then commit.
```

---

### Prompt: Task 9 — Drafts Page and Sidebar

```
You are implementing Task 9 of OutboundOS Phase 10: the /drafts review queue page and sidebar navigation.

**Files to create/modify:**
- src/features/drafts/components/drafts-table.tsx — DraftsTable component
- src/app/(dashboard)/drafts/page.tsx — server component
- src/app/(dashboard)/drafts/drafts-client.tsx — client component
- src/components/layout/sidebar.tsx — add /drafts nav item

**DraftsTable columns:** Lead name/email, Subject preview (truncated), Status badge (Pending/Approved/Rejected), Created date (hidden on mobile), Actions (Review button for PENDING_REVIEW only).

**DraftsPage (server component):**
- auth() → redirect if no orgId
- call getDrafts({ organizationId: orgId }) directly (no GET API route)
- render Header title="Drafts" + DraftsClient

**DraftsClient (client component):**
- Props: initialDrafts: DraftWithLeadDTO[], initialTotal: number
- State: drafts, total, reviewingDraft: DraftDTO | null
- handleReview(draft): set reviewingDraft
- handleDraftReviewed(updated): remove from list, decrement total, close drawer
- Render DraftsTable + DraftReviewDrawer

**Sidebar:**
- Add Mail icon from lucide-react
- Add { href: '/drafts', icon: Mail, label: 'Drafts' } after /leads in NAV_ITEMS

Dark theme palette: bg-[#13151c], borders #1e2130, row hover #1a1d2e.

Run npx tsc --noEmit && npm test, then commit.
```
