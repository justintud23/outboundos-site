# Inbound Reply Ingestion & Classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept inbound email replies, run AI classification against the existing `ReplyClassification` enum, and persist them as org-scoped `InboundReply` rows linked to the originating lead and outbound message.

**Architecture:** A thin POST `/api/replies` route (Clerk-authenticated, stub for real email provider integration) delegates to `ingestReply` in `src/features/replies/server/`. That function looks up the lead by email, optionally links the outbound message by SendGrid message ID, calls the AI provider's new `classifyReply` method, and writes the `InboundReply` row. The AI layer stays provider-agnostic — `classifyReply` is added to the `AIProvider` interface, implemented in `OpenAIProvider`, and uses a DB prompt template when available with a hardcoded fallback.

**Tech Stack:** Prisma v7, Next.js 16 App Router, OpenAI via `src/lib/ai`, Vitest v4, Clerk v7

---

## Schema reference (read-only — no migrations needed)

`InboundReply` model already exists:
```prisma
model InboundReply {
  id                String           @id @default(cuid())
  organizationId    String
  organization      Organization     @relation(...)
  leadId            String
  lead              Lead             @relation(...)
  outboundMessageId String?
  outboundMessage   OutboundMessage? @relation(...)
  rawBody                  String
  classification           ReplyClassification @default(UNKNOWN)
  classificationConfidence Float?
  receivedAt DateTime @default(now())
  createdAt  DateTime @default(now())
}

enum ReplyClassification {
  POSITIVE          // interested
  NEUTRAL           // unclear / soft positive
  NEGATIVE          // not interested
  OUT_OF_OFFICE     // automated OOO
  UNSUBSCRIBE_REQUEST
  REFERRAL
  UNKNOWN
}
```

`Lead` has `@@unique([organizationId, email])` → Prisma compound key: `organizationId_email`.
`OutboundMessage` has `sgMessageId String? @unique` → lookup by SendGrid message ID.
`PromptTemplate` has `promptType REPLY_CLASSIFICATION` → used for AI prompt; fallback hardcoded.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Modify | `src/lib/ai/provider.ts` | Add `ReplyClassifyInput`, `ReplyClassifyOutput`, `classifyReply` to `AIProvider` |
| Modify | `src/lib/ai/openai.ts` | Implement `classifyReply` with JSON output + fallback |
| Modify | `src/lib/ai/index.ts` | Export new types |
| Modify | `src/lib/ai/openai.test.ts` | Add `classifyReply` tests |
| Create | `src/features/replies/types.ts` | `InboundReplyDTO`, `LeadNotFoundByEmailError` |
| Create | `src/features/replies/server/ingest-reply.ts` | Lookup lead + message, classify, write row |
| Create | `src/features/replies/server/ingest-reply.test.ts` | Unit tests with mocked Prisma + AI |
| Create | `src/app/api/replies/route.ts` | Thin POST handler |

---

## Task 1: Extend AIProvider with classifyReply

**Files:**
- Modify: `src/lib/ai/provider.ts`
- Modify: `src/lib/ai/openai.ts`
- Modify: `src/lib/ai/index.ts`
- Test: `src/lib/ai/openai.test.ts`

- [ ] **Step 1: Write failing tests for classifyReply**

Append to `src/lib/ai/openai.test.ts` (after the existing `draftEmail` describe block — keep existing tests intact):

```ts
describe('OpenAIProvider.classifyReply', () => {
  let provider: OpenAIProvider
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    provider = new OpenAIProvider('test-key', 'gpt-4o')
    const client = (OpenAI as unknown as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      chat: { completions: { create: ReturnType<typeof vi.fn> } }
    }
    mockCreate = client.chat.completions.create
  })

  it('returns classification and confidence from AI response', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: 'POSITIVE', confidence: 0.95 }) } }],
    })

    const result = await provider.classifyReply({ rawBody: 'I am very interested!' }, 'classify prompt')

    expect(result).toEqual({ classification: 'POSITIVE', confidence: 0.95 })
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ temperature: 0.1 }))
  })

  it('returns UNKNOWN with 0 confidence on parse failure', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not json' } }],
    })

    const result = await provider.classifyReply({ rawBody: 'some reply' }, 'classify prompt')

    expect(result).toEqual({ classification: 'UNKNOWN', confidence: 0 })
  })

  it('returns UNKNOWN with 0 confidence on unrecognised classification value', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: 'GIBBERISH', confidence: 0.9 }) } }],
    })

    const result = await provider.classifyReply({ rawBody: 'some reply' }, 'classify prompt')

    expect(result).toEqual({ classification: 'UNKNOWN', confidence: 0 })
  })

  it('clamps confidence to 0–1 range', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: 'NEGATIVE', confidence: 1.5 }) } }],
    })

    const result = await provider.classifyReply({ rawBody: 'Not interested' }, 'classify prompt')

    expect(result.confidence).toBe(1)
    expect(result.classification).toBe('NEGATIVE')
  })

  it('passes rawBody as user message', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ classification: 'OUT_OF_OFFICE', confidence: 0.99 }) } }],
    })

    await provider.classifyReply({ rawBody: 'I am on holiday' }, 'system prompt here')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          { role: 'system', content: 'system prompt here' },
          { role: 'user', content: 'I am on holiday' },
        ]),
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx vitest run src/lib/ai/openai.test.ts 2>&1
```

Expected: FAIL — `provider.classifyReply is not a function`.

- [ ] **Step 3: Add types to provider.ts**

Full replacement of `src/lib/ai/provider.ts`:

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

export interface ReplyClassifyInput {
  rawBody: string
}

export type ReplyClassificationValue =
  | 'POSITIVE'
  | 'NEUTRAL'
  | 'NEGATIVE'
  | 'OUT_OF_OFFICE'
  | 'UNSUBSCRIBE_REQUEST'
  | 'REFERRAL'
  | 'UNKNOWN'

export interface ReplyClassifyOutput {
  classification: ReplyClassificationValue
  confidence: number  // 0–1
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

  classifyReply(
    input: ReplyClassifyInput,
    promptTemplate: string,
  ): Promise<ReplyClassifyOutput>
}
```

- [ ] **Step 4: Implement classifyReply in openai.ts**

Add the `classifyReply` method to `OpenAIProvider` in `src/lib/ai/openai.ts`. Add it after the `draftEmail` method, before the closing `}` of the class:

```ts
  async classifyReply(
    input: ReplyClassifyInput,
    promptTemplate: string,
  ): Promise<ReplyClassifyOutput> {
    const VALID: ReplyClassificationValue[] = [
      'POSITIVE', 'NEUTRAL', 'NEGATIVE', 'OUT_OF_OFFICE',
      'UNSUBSCRIBE_REQUEST', 'REFERRAL', 'UNKNOWN',
    ]

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: promptTemplate },
          { role: 'user', content: input.rawBody },
        ],
        temperature: 0.1,
      })

      const content = response.choices[0]?.message.content ?? ''
      const raw = JSON.parse(content) as { classification?: unknown; confidence?: unknown }

      if (typeof raw.classification !== 'string' || !VALID.includes(raw.classification as ReplyClassificationValue)) {
        throw new SyntaxError(`Invalid classification: ${raw.classification}`)
      }

      const confidence = typeof raw.confidence === 'number'
        ? Math.max(0, Math.min(1, raw.confidence))
        : 0.5

      return {
        classification: raw.classification as ReplyClassificationValue,
        confidence,
      }
    } catch (err) {
      console.warn('[OpenAIProvider.classifyReply] fallback triggered', err)
      return { classification: 'UNKNOWN', confidence: 0 }
    }
  }
```

Also add the `ReplyClassifyInput`, `ReplyClassifyOutput`, and `ReplyClassificationValue` imports at the top of `openai.ts`:

```ts
import type { AIProvider, LeadScoreInput, LeadScoreOutput, EmailDraftInput, EmailDraftOutput, ReplyClassifyInput, ReplyClassifyOutput, ReplyClassificationValue } from './provider'
```

- [ ] **Step 5: Export new types from index.ts**

Full replacement of `src/lib/ai/index.ts`:

```ts
export { getAIProvider } from './router'
export type {
  AIProvider,
  LeadScoreInput,
  LeadScoreOutput,
  EmailDraftInput,
  EmailDraftOutput,
  ReplyClassifyInput,
  ReplyClassifyOutput,
  ReplyClassificationValue,
} from './provider'
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx vitest run src/lib/ai/openai.test.ts 2>&1
```

Expected: all tests pass (existing + 5 new `classifyReply` tests).

- [ ] **Step 7: Type-check**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && git add src/lib/ai/provider.ts src/lib/ai/openai.ts src/lib/ai/index.ts src/lib/ai/openai.test.ts && git commit -m "feat: add classifyReply to AIProvider and OpenAIProvider

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Reply types

**Files:**
- Create: `src/features/replies/types.ts`

- [ ] **Step 1: Create types file**

Create `src/features/replies/types.ts`:

```ts
import type { ReplyClassification } from '@prisma/client'

export interface InboundReplyDTO {
  id: string
  organizationId: string
  leadId: string
  outboundMessageId: string | null
  rawBody: string
  classification: ReplyClassification
  classificationConfidence: number | null
  receivedAt: Date
  createdAt: Date
}

export class LeadNotFoundByEmailError extends Error {
  constructor(public readonly email: string) {
    super(`No lead found with email: ${email}`)
    this.name = 'LeadNotFoundByEmailError'
    Object.setPrototypeOf(this, LeadNotFoundByEmailError.prototype)
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && git add src/features/replies/types.ts && git commit -m "feat: add InboundReplyDTO and LeadNotFoundByEmailError types

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: ingestReply server function

**Files:**
- Create: `src/features/replies/server/ingest-reply.ts`
- Test: `src/features/replies/server/ingest-reply.test.ts`

**Key lookups:**
- Lead: `prisma.lead.findUnique({ where: { organizationId_email: { organizationId, email: fromEmail } } })` — uses the compound unique index
- OutboundMessage: `prisma.outboundMessage.findUnique({ where: { sgMessageId: inReplyToSgMessageId } })` — optional, null if not found
- PromptTemplate: `prisma.promptTemplate.findFirst({ where: { organizationId, promptType: 'REPLY_CLASSIFICATION', isActive: true } })`

**Fallback prompt** (used when no `REPLY_CLASSIFICATION` template is active):
```
You are an email reply classifier for a sales team.
Classify the reply into exactly one category:
- POSITIVE: Lead is interested, asking questions, or responding positively
- NEUTRAL: Unclear intent or polite acknowledgment without commitment
- NEGATIVE: Not interested or rejected the offer
- OUT_OF_OFFICE: Automated out-of-office or vacation response
- UNSUBSCRIBE_REQUEST: Requesting to be removed from the mailing list
- REFERRAL: Referring someone else who might be interested
- UNKNOWN: Cannot classify with confidence

Return ONLY a JSON object: { "classification": "<CATEGORY>", "confidence": <0.0-1.0> }
No markdown, no explanation.
```

- [ ] **Step 1: Write failing tests**

Create `src/features/replies/server/ingest-reply.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead:            { findUnique: vi.fn() },
    outboundMessage: { findUnique: vi.fn() },
    promptTemplate:  { findFirst: vi.fn() },
    inboundReply:    { create: vi.fn() },
  },
}))

vi.mock('@/lib/ai', () => ({
  getAIProvider: vi.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { ingestReply } from './ingest-reply'
import { LeadNotFoundByEmailError } from '../types'

const mockLeadFindUnique    = prisma.lead.findUnique           as ReturnType<typeof vi.fn>
const mockMsgFindUnique     = prisma.outboundMessage.findUnique as ReturnType<typeof vi.fn>
const mockTemplateFindFirst = prisma.promptTemplate.findFirst   as ReturnType<typeof vi.fn>
const mockReplyCreate       = prisma.inboundReply.create        as ReturnType<typeof vi.fn>
const mockGetAIProvider     = getAIProvider                     as ReturnType<typeof vi.fn>

const baseLead    = { id: 'lead-1' }
const baseMessage = { id: 'msg-1' }
const baseReply   = {
  id: 'reply-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  outboundMessageId: 'msg-1',
  rawBody: 'Sounds great!',
  classification: 'POSITIVE' as const,
  classificationConfidence: 0.92,
  receivedAt: new Date(),
  createdAt: new Date(),
}

function mockProvider(classification = 'POSITIVE', confidence = 0.92) {
  mockGetAIProvider.mockReturnValue({
    classifyReply: vi.fn().mockResolvedValue({ classification, confidence }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTemplateFindFirst.mockResolvedValue(null) // use fallback prompt by default
})

describe('ingestReply', () => {
  it('creates an InboundReply with classification and outboundMessage link', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockMsgFindUnique.mockResolvedValue(baseMessage)
    mockProvider('POSITIVE', 0.92)
    mockReplyCreate.mockResolvedValue(baseReply)

    const result = await ingestReply({
      organizationId: 'org-1',
      fromEmail: 'lead@acme.com',
      rawBody: 'Sounds great!',
      inReplyToSgMessageId: 'sg-msg-abc',
    })

    expect(mockLeadFindUnique).toHaveBeenCalledWith({
      where: { organizationId_email: { organizationId: 'org-1', email: 'lead@acme.com' } },
      select: { id: true },
    })
    expect(mockMsgFindUnique).toHaveBeenCalledWith({
      where: { sgMessageId: 'sg-msg-abc' },
      select: { id: true },
    })
    expect(mockReplyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        leadId: 'lead-1',
        outboundMessageId: 'msg-1',
        rawBody: 'Sounds great!',
        classification: 'POSITIVE',
        classificationConfidence: 0.92,
      }),
    })
    expect(result.id).toBe('reply-1')
  })

  it('throws LeadNotFoundByEmailError when lead does not exist', async () => {
    mockLeadFindUnique.mockResolvedValue(null)
    mockProvider()

    await expect(
      ingestReply({ organizationId: 'org-1', fromEmail: 'unknown@example.com', rawBody: 'hi' }),
    ).rejects.toThrow(LeadNotFoundByEmailError)
  })

  it('sets outboundMessageId to null when inReplyToSgMessageId is not provided', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockProvider('NEUTRAL', 0.7)
    mockReplyCreate.mockResolvedValue({ ...baseReply, outboundMessageId: null, classification: 'NEUTRAL', classificationConfidence: 0.7 })

    await ingestReply({ organizationId: 'org-1', fromEmail: 'lead@acme.com', rawBody: 'Thanks' })

    expect(mockMsgFindUnique).not.toHaveBeenCalled()
    expect(mockReplyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ outboundMessageId: null }),
    })
  })

  it('sets outboundMessageId to null when sgMessageId does not match any message', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockMsgFindUnique.mockResolvedValue(null)
    mockProvider('NEGATIVE', 0.88)
    mockReplyCreate.mockResolvedValue({ ...baseReply, outboundMessageId: null })

    await ingestReply({
      organizationId: 'org-1',
      fromEmail: 'lead@acme.com',
      rawBody: 'Not interested',
      inReplyToSgMessageId: 'sg-unknown',
    })

    expect(mockReplyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ outboundMessageId: null }),
    })
  })

  it('uses custom prompt template when one is active', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockTemplateFindFirst.mockResolvedValue({ body: 'custom classify prompt' })
    const mockClassify = vi.fn().mockResolvedValue({ classification: 'POSITIVE', confidence: 0.8 })
    mockGetAIProvider.mockReturnValue({ classifyReply: mockClassify })
    mockReplyCreate.mockResolvedValue(baseReply)

    await ingestReply({ organizationId: 'org-1', fromEmail: 'lead@acme.com', rawBody: 'Yes!' })

    expect(mockTemplateFindFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', promptType: 'REPLY_CLASSIFICATION', isActive: true },
    })
    expect(mockClassify).toHaveBeenCalledWith({ rawBody: 'Yes!' }, 'custom classify prompt')
  })

  it('uses fallback prompt when no template is active', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockTemplateFindFirst.mockResolvedValue(null)
    const mockClassify = vi.fn().mockResolvedValue({ classification: 'UNKNOWN', confidence: 0 })
    mockGetAIProvider.mockReturnValue({ classifyReply: mockClassify })
    mockReplyCreate.mockResolvedValue({ ...baseReply, classification: 'UNKNOWN', classificationConfidence: 0 })

    await ingestReply({ organizationId: 'org-1', fromEmail: 'lead@acme.com', rawBody: '???' })

    // Second arg to classifyReply should be the non-empty fallback prompt string
    const [, promptUsed] = mockClassify.mock.calls[0] as [unknown, string]
    expect(promptUsed).toContain('POSITIVE')
    expect(promptUsed).toContain('UNSUBSCRIBE_REQUEST')
  })

  it('stores receivedAt when provided', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockProvider('OUT_OF_OFFICE', 0.99)
    const customDate = new Date('2026-01-15T10:00:00Z')
    mockReplyCreate.mockResolvedValue({ ...baseReply, receivedAt: customDate })

    await ingestReply({
      organizationId: 'org-1',
      fromEmail: 'lead@acme.com',
      rawBody: 'OOO until Jan 20',
      receivedAt: customDate,
    })

    expect(mockReplyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ receivedAt: customDate }),
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx vitest run src/features/replies/server/ingest-reply.test.ts 2>&1
```

Expected: FAIL — `ingestReply` not defined.

- [ ] **Step 3: Implement ingestReply**

Create `src/features/replies/server/ingest-reply.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import type { InboundReplyDTO } from '../types'
import { LeadNotFoundByEmailError } from '../types'

const FALLBACK_CLASSIFY_PROMPT = `You are an email reply classifier for a sales team.
Classify the reply into exactly one category:
- POSITIVE: Lead is interested, asking questions, or responding positively
- NEUTRAL: Unclear intent or polite acknowledgment without commitment
- NEGATIVE: Not interested or rejected the offer
- OUT_OF_OFFICE: Automated out-of-office or vacation response
- UNSUBSCRIBE_REQUEST: Requesting to be removed from the mailing list
- REFERRAL: Referring someone else who might be interested
- UNKNOWN: Cannot classify with confidence

Return ONLY a JSON object: { "classification": "<CATEGORY>", "confidence": <0.0-1.0> }
No markdown, no explanation.`

interface IngestReplyInput {
  organizationId: string
  fromEmail: string
  rawBody: string
  inReplyToSgMessageId?: string
  receivedAt?: Date
}

export async function ingestReply({
  organizationId,
  fromEmail,
  rawBody,
  inReplyToSgMessageId,
  receivedAt,
}: IngestReplyInput): Promise<InboundReplyDTO> {
  // 1. Find lead by email (org-scoped compound unique)
  const lead = await prisma.lead.findUnique({
    where: { organizationId_email: { organizationId, email: fromEmail } },
    select: { id: true },
  })

  if (!lead) {
    throw new LeadNotFoundByEmailError(fromEmail)
  }

  // 2. Optionally link to outbound message
  let outboundMessageId: string | null = null
  if (inReplyToSgMessageId) {
    const message = await prisma.outboundMessage.findUnique({
      where: { sgMessageId: inReplyToSgMessageId },
      select: { id: true },
    })
    outboundMessageId = message?.id ?? null
  }

  // 3. Fetch active REPLY_CLASSIFICATION template (fallback to hardcoded prompt)
  const template = await prisma.promptTemplate.findFirst({
    where: { organizationId, promptType: 'REPLY_CLASSIFICATION', isActive: true },
  })
  const prompt = template?.body ?? FALLBACK_CLASSIFY_PROMPT

  // 4. AI classification — outside any transaction
  const { classification, confidence } = await getAIProvider().classifyReply({ rawBody }, prompt)

  // 5. Persist
  const reply = await prisma.inboundReply.create({
    data: {
      organizationId,
      leadId: lead.id,
      outboundMessageId,
      rawBody,
      classification,
      classificationConfidence: confidence,
      ...(receivedAt !== undefined && { receivedAt }),
    },
  })

  return {
    id: reply.id,
    organizationId: reply.organizationId,
    leadId: reply.leadId,
    outboundMessageId: reply.outboundMessageId,
    rawBody: reply.rawBody,
    classification: reply.classification,
    classificationConfidence: reply.classificationConfidence,
    receivedAt: reply.receivedAt,
    createdAt: reply.createdAt,
  }
}
```

- [ ] **Step 4: Run tests — must pass**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx vitest run src/features/replies/server/ingest-reply.test.ts 2>&1
```

Expected: 7 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx vitest run 2>&1
```

Expected: all tests pass.

- [ ] **Step 6: Type-check**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && git add src/features/replies/server/ingest-reply.ts src/features/replies/server/ingest-reply.test.ts && git commit -m "feat: add ingestReply — lookup, classify, and persist inbound replies

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: POST /api/replies ingestion route

**Files:**
- Create: `src/app/api/replies/route.ts`

**Behaviour:**
- Requires Clerk auth (org-scoped stub — real email provider webhook integration comes later)
- Accepts `{ fromEmail, rawBody, subject?, inReplyToSgMessageId?, receivedAt? }`
- `fromEmail` and `rawBody` are required strings
- Returns 404 when lead not found (with clear message — caller can handle or log)
- Returns 201 + `InboundReplyDTO` on success

- [ ] **Step 1: Create the route**

Create `src/app/api/replies/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { ingestReply } from '@/features/replies/server/ingest-reply'
import { LeadNotFoundByEmailError } from '@/features/replies/types'

export async function POST(request: Request) {
  const { orgId } = await auth()

  if (!orgId) {
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
    typeof (body as Record<string, unknown>).fromEmail !== 'string' ||
    typeof (body as Record<string, unknown>).rawBody !== 'string'
  ) {
    return NextResponse.json(
      { error: 'fromEmail and rawBody are required strings' },
      { status: 400 },
    )
  }

  const {
    fromEmail,
    rawBody,
    inReplyToSgMessageId,
    receivedAt,
  } = body as {
    fromEmail: string
    rawBody: string
    inReplyToSgMessageId?: string
    receivedAt?: string
  }

  try {
    const org = await resolveOrganization(orgId)
    const reply = await ingestReply({
      organizationId: org.id,
      fromEmail,
      rawBody,
      inReplyToSgMessageId,
      receivedAt: receivedAt !== undefined ? new Date(receivedAt) : undefined,
    })
    return NextResponse.json(reply, { status: 201 })
  } catch (err) {
    if (err instanceof LeadNotFoundByEmailError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    console.error('[POST /api/replies]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 3: Run full suite**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx vitest run 2>&1
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && git add src/app/api/replies/route.ts && git commit -m "feat: add POST /api/replies ingestion stub

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- ✅ Create InboundReply model usage — `ingestReply` creates rows
- ✅ Build ingestion endpoint (stub) — `POST /api/replies`
- ✅ Store raw reply content — `rawBody` field
- ✅ AI classification — `classifyReply` in AIProvider + OpenAIProvider
- ✅ All 7 classifications — POSITIVE/NEUTRAL/NEGATIVE/OUT_OF_OFFICE/UNSUBSCRIBE_REQUEST/REFERRAL/UNKNOWN
- ✅ Store classification + confidence — `classification` + `classificationConfidence`
- ✅ Link to lead — `leadId` via `fromEmail` lookup
- ✅ Link to outboundMessage if possible — `outboundMessageId` via `sgMessageId` lookup
- ✅ All logic in src/features/replies/server
- ✅ Route handler thin
- ✅ Organization-scoped

**Spec → user's classification names → schema enum mapping:**
- interested → POSITIVE ✅
- not interested → NEGATIVE ✅
- out of office → OUT_OF_OFFICE ✅
- unsubscribe → UNSUBSCRIBE_REQUEST ✅
- other → UNKNOWN (+ NEUTRAL/REFERRAL for more specific "other" cases) ✅

**Type consistency check:**
- `ReplyClassificationValue` defined in `provider.ts`, matches all Prisma `ReplyClassification` string values ✅
- `InboundReplyDTO.classification` is `ReplyClassification` (Prisma type) — compatible since values are identical strings ✅
- `ingestReply` receives `ReplyClassificationValue` from AI, passes directly to Prisma `classification` field — compatible ✅
- `LeadNotFoundByEmailError` defined in `types.ts`, thrown by `ingestReply`, caught by route ✅
