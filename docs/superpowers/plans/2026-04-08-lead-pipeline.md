# Lead State + Pipeline Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add INTERESTED/NOT_INTERESTED lead statuses, build a centralized status transition engine with audit trail, integrate auto-transitions from reply classification and message send, add manual status update endpoint, and build a drag-and-drop Kanban pipeline board.

**Architecture:** All status changes go through a single `transitionLeadStatus()` function that enforces STATUS_ORDER (no auto-downgrade), terminal state rules, creates LeadStatusChange audit records, and in future will stop active sequence enrollments. The pipeline board uses @dnd-kit for drag-and-drop with optimistic UI updates. Schema migration adds all models/fields/indexes needed by all 3 planned features (pipeline, sequences, inbox).

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL, TypeScript strict, Tailwind v4, @dnd-kit/core + @dnd-kit/sortable, clsx, lucide-react.

**Spec:** `docs/superpowers/specs/2026-04-08-three-features-design.md`

---

## File Structure

**Create:**
- `src/features/leads/server/transition-lead-status.ts` — core transition engine
- `src/features/leads/server/transition-lead-status.test.ts` — tests
- `src/features/leads/server/update-lead-status.ts` — manual update wrapper
- `src/features/leads/server/get-pipeline-leads.ts` — pipeline query
- `src/features/leads/server/get-pipeline-leads.test.ts` — tests
- `src/app/api/leads/[id]/status/route.ts` — PATCH endpoint
- `src/app/api/leads/[id]/status/route.test.ts` — tests
- `src/app/(dashboard)/pipeline/page.tsx` — server page
- `src/app/(dashboard)/pipeline/pipeline-client.tsx` — client orchestrator
- `src/features/leads/components/pipeline-board.tsx` — DnD board
- `src/features/leads/components/pipeline-card.tsx` — lead card

**Modify:**
- `prisma/schema.prisma` — enum additions, new models, new fields, new indexes
- `src/features/leads/types.ts` — new DTOs and error classes
- `src/features/replies/server/ingest-reply.ts` — add auto-transition call
- `src/features/replies/server/ingest-reply.test.ts` — update tests
- `src/features/messages/server/send-draft.ts` — add terminal check + auto-transition
- `src/features/messages/server/send-draft.test.ts` — update tests
- `src/components/layout/sidebar.tsx` — add Pipeline nav item
- `package.json` — add @dnd-kit dependencies

---

### Task 1: Schema Migration

**Files:**
- Modify: `prisma/schema.prisma`

This single migration adds all schema changes needed across all 3 features (pipeline, sequences, inbox) so we don't need multiple migrations later.

- [ ] **Step 1: Add new enums to schema.prisma**

After the existing `LeadStatus` enum, add `INTERESTED` and `NOT_INTERESTED`. Add the new `EnrollmentStatus` enum after `ReplyClassification`.

In `prisma/schema.prisma`, update the `LeadStatus` enum:

```prisma
enum LeadStatus {
  NEW
  CONTACTED
  REPLIED
  BOUNCED
  UNSUBSCRIBED
  CONVERTED
  INTERESTED
  NOT_INTERESTED
}
```

Add new enum after `ReplyClassification`:

```prisma
enum EnrollmentStatus {
  ACTIVE
  PAUSED
  COMPLETED
  STOPPED
}
```

- [ ] **Step 2: Add LeadStatusChange model**

Add after the `Lead` model section:

```prisma
// ─── LEAD STATUS CHANGES ──────────────────────────────────────

model LeadStatusChange {
  id             String     @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  leadId         String
  lead           Lead       @relation(fields: [leadId], references: [id], onDelete: Cascade)

  fromStatus   LeadStatus
  toStatus     LeadStatus
  trigger      String        // "auto:reply_classification", "auto:message_sent", "manual:user"
  actorClerkId String?       // null for automated changes
  metadata     Json?

  createdAt DateTime @default(now())

  @@index([organizationId])
  @@index([leadId])
  @@index([organizationId, leadId])
  @@map("lead_status_changes")
}
```

- [ ] **Step 3: Add SequenceEnrollment model**

Add after the `SequenceStep` model:

```prisma
// ─── SEQUENCE ENROLLMENTS ─────────────────────────────────────

model SequenceEnrollment {
  id                  String           @id @default(cuid())
  organizationId      String
  organization        Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  sequenceId          String
  sequence            Sequence         @relation(fields: [sequenceId], references: [id], onDelete: Cascade)
  leadId              String
  lead                Lead             @relation(fields: [leadId], references: [id], onDelete: Cascade)

  currentStepNumber   Int              @default(0)
  status              EnrollmentStatus @default(ACTIVE)
  nextDueAt           DateTime?
  processing          Boolean          @default(false)
  processingStartedAt DateTime?
  startedAt           DateTime         @default(now())
  pausedAt            DateTime?
  stoppedAt           DateTime?
  stoppedReason       String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  drafts Draft[]

  @@unique([sequenceId, leadId])
  @@index([organizationId])
  @@index([status, nextDueAt])
  @@index([leadId])
  @@map("sequence_enrollments")
}
```

- [ ] **Step 4: Add relations and fields to existing models**

Add `leadStatusChanges` and `sequenceEnrollments` relations to `Organization` model (after existing relations):

```prisma
  leadStatusChanges  LeadStatusChange[]
  sequenceEnrollments SequenceEnrollment[]
```

Add `statusChanges` and `sequenceEnrollments` relations to `Lead` model (after `inboundReplies`):

```prisma
  statusChanges      LeadStatusChange[]
  sequenceEnrollments SequenceEnrollment[]
```

Add `enrollments` relation to `Sequence` model (after `drafts`):

```prisma
  enrollments SequenceEnrollment[]
```

Add `sequenceEnrollmentId` field and relation to `Draft` model (after `sequenceStep` relation):

```prisma
  sequenceEnrollmentId String?
  sequenceEnrollment   SequenceEnrollment? @relation(fields: [sequenceEnrollmentId], references: [id])
```

Add `isRead` field to `InboundReply` model (after `classificationConfidence`):

```prisma
  isRead Boolean @default(false)
```

- [ ] **Step 5: Add indexes to existing models**

Add to `InboundReply` (after existing indexes):

```prisma
  @@index([organizationId, isRead])
  @@index([organizationId, receivedAt])
  @@index([leadId, receivedAt])
```

Add to `OutboundMessage` (after existing indexes):

```prisma
  @@index([organizationId, sentAt])
  @@index([leadId, sentAt])
```

- [ ] **Step 6: Generate and apply migration**

Run:
```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site"
npx prisma migrate dev --name add-pipeline-sequences-inbox-schema
```

Expected: Migration creates successfully. Existing data is preserved (enum additions are non-breaking, new models are empty, new fields have defaults or are nullable).

- [ ] **Step 7: Verify Prisma client generation**

Run: `npx prisma generate`
Expected: Client generated successfully with new types.

- [ ] **Step 8: Commit**

```bash
git add prisma/
git commit -m "feat: add schema for pipeline, sequences, and inbox features

Adds INTERESTED/NOT_INTERESTED to LeadStatus enum, EnrollmentStatus enum,
LeadStatusChange model, SequenceEnrollment model, isRead on InboundReply,
sequenceEnrollmentId on Draft, and activity indexes."
```

---

### Task 2: Lead Types and Error Classes

**Files:**
- Modify: `src/features/leads/types.ts`

- [ ] **Step 1: Add PipelineLeadDTO and error classes**

Add the following to the end of `src/features/leads/types.ts`:

```typescript
import type { LeadStatus } from '@prisma/client'

// ─── Pipeline ────────────────────────────────────────────────

export interface PipelineLeadDTO {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  company: string | null
  status: LeadStatus
  score: number | null
  lastActivityAt: Date
}

export interface TransitionInput {
  organizationId: string
  leadId: string
  newStatus: LeadStatus
  trigger: string
  actorClerkId?: string
  metadata?: Record<string, unknown>
}

export interface TransitionResult {
  changed: boolean
  lead: LeadDTO
  previousStatus: LeadStatus
}

// ─── Status constants ────────────────────────────────────────

export const STATUS_ORDER: Record<string, number> = {
  NEW: 0,
  CONTACTED: 1,
  REPLIED: 2,
  INTERESTED: 3,
  CONVERTED: 4,
}

export const TERMINAL_STATUSES: LeadStatus[] = ['NOT_INTERESTED', 'UNSUBSCRIBED', 'BOUNCED']

export const PIPELINE_COLUMNS: LeadStatus[] = ['NEW', 'CONTACTED', 'REPLIED', 'INTERESTED', 'CONVERTED']

export const CLASSIFICATION_TO_STATUS: Record<string, LeadStatus> = {
  POSITIVE: 'INTERESTED',
  NEGATIVE: 'NOT_INTERESTED',
  OUT_OF_OFFICE: 'REPLIED',
  UNSUBSCRIBE_REQUEST: 'UNSUBSCRIBED',
  REFERRAL: 'REPLIED',
  NEUTRAL: 'REPLIED',
  UNKNOWN: 'REPLIED',
}

// ─── Errors ──────────────────────────────────────────────────

export class LeadNotFoundError extends Error {
  constructor(public readonly leadId: string) {
    super(`Lead not found: ${leadId}`)
    this.name = 'LeadNotFoundError'
    Object.setPrototypeOf(this, LeadNotFoundError.prototype)
  }
}

export class LeadInTerminalStateError extends Error {
  constructor(public readonly leadId: string, public readonly status: LeadStatus) {
    super(`Lead ${leadId} is in terminal state: ${status}`)
    this.name = 'LeadInTerminalStateError'
    Object.setPrototypeOf(this, LeadInTerminalStateError.prototype)
  }
}
```

Note: The existing `src/features/drafts/types.ts` has a `LeadNotFoundError` without a `leadId` parameter. The one we're adding here is in `leads/types.ts` and has a different signature. They coexist without conflict since they're in different modules.

Also add `import type { LeadStatus } from '@prisma/client'` at the top of the file if not already present (the existing file imports `Lead` from `@prisma/client` — add `LeadStatus` to that import).

- [ ] **Step 2: Commit**

```bash
git add src/features/leads/types.ts
git commit -m "feat: add pipeline DTOs, status constants, and error classes"
```

---

### Task 3: Transition Lead Status — Core Engine

**Files:**
- Create: `src/features/leads/server/transition-lead-status.ts`
- Create: `src/features/leads/server/transition-lead-status.test.ts`

- [ ] **Step 1: Write transition-lead-status.test.ts**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findFirst: vi.fn(), update: vi.fn() },
    leadStatusChange: { create: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { transitionLeadStatus } from './transition-lead-status'
import { LeadNotFoundError } from '../types'

const mockFindFirst = prisma.lead.findFirst as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

const ORG = 'org-1'

function makeLead(status: string) {
  return {
    id: 'lead-1',
    organizationId: ORG,
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'Lead',
    company: 'Acme',
    title: null,
    source: 'CSV',
    status,
    score: 80,
    scoreReason: null,
    scoredAt: null,
    createdAt: new Date(),
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  // Default: $transaction executes the callback
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
    return fn({
      lead: { update: vi.fn().mockResolvedValue({ ...makeLead('CONTACTED'), status: 'CONTACTED' }) },
      leadStatusChange: { create: vi.fn().mockResolvedValue({}) },
      sequenceEnrollment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    })
  })
})

describe('transitionLeadStatus', () => {
  it('throws LeadNotFoundError if lead does not exist', async () => {
    mockFindFirst.mockResolvedValue(null)

    await expect(
      transitionLeadStatus({
        organizationId: ORG,
        leadId: 'nonexistent',
        newStatus: 'CONTACTED',
        trigger: 'manual:user',
        actorClerkId: 'user-1',
      }),
    ).rejects.toThrow(LeadNotFoundError)
  })

  it('returns changed: false if status is already the target', async () => {
    mockFindFirst.mockResolvedValue(makeLead('CONTACTED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'CONTACTED',
      trigger: 'auto:message_sent',
    })

    expect(result.changed).toBe(false)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('auto-transitions upgrade status in pipeline order', async () => {
    mockFindFirst.mockResolvedValue(makeLead('NEW'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'CONTACTED',
      trigger: 'auto:message_sent',
    })

    expect(result.changed).toBe(true)
    expect(mockTransaction).toHaveBeenCalled()
  })

  it('auto-transitions do NOT downgrade (INTERESTED → REPLIED is skipped)', async () => {
    mockFindFirst.mockResolvedValue(makeLead('INTERESTED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'REPLIED',
      trigger: 'auto:reply_classification',
    })

    expect(result.changed).toBe(false)
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('auto-transitions INTO terminal states always apply', async () => {
    mockFindFirst.mockResolvedValue(makeLead('INTERESTED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'UNSUBSCRIBED',
      trigger: 'auto:reply_classification',
    })

    expect(result.changed).toBe(true)
  })

  it('auto-transitions OUT of terminal states are blocked', async () => {
    mockFindFirst.mockResolvedValue(makeLead('UNSUBSCRIBED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'REPLIED',
      trigger: 'auto:reply_classification',
    })

    expect(result.changed).toBe(false)
  })

  it('manual transitions CAN move out of terminal states', async () => {
    mockFindFirst.mockResolvedValue(makeLead('NOT_INTERESTED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'NEW',
      trigger: 'manual:user',
      actorClerkId: 'user-1',
    })

    expect(result.changed).toBe(true)
  })

  it('manual transitions CAN downgrade in pipeline', async () => {
    mockFindFirst.mockResolvedValue(makeLead('INTERESTED'))

    const result = await transitionLeadStatus({
      organizationId: ORG,
      leadId: 'lead-1',
      newStatus: 'NEW',
      trigger: 'manual:user',
      actorClerkId: 'user-1',
    })

    expect(result.changed).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/leads/server/transition-lead-status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement transition-lead-status.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { LeadStatus } from '@prisma/client'
import type { LeadDTO, TransitionInput, TransitionResult } from '../types'
import { LeadNotFoundError, STATUS_ORDER, TERMINAL_STATUSES } from '../types'

function isTerminal(status: LeadStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

function statusRank(status: LeadStatus): number | undefined {
  return STATUS_ORDER[status]
}

const LEAD_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  company: true,
  title: true,
  source: true,
  status: true,
  score: true,
  scoreReason: true,
  scoredAt: true,
  createdAt: true,
} as const

export async function transitionLeadStatus(input: TransitionInput): Promise<TransitionResult> {
  const { organizationId, leadId, newStatus, trigger, actorClerkId, metadata } = input

  // 1. Fetch lead (org-scoped)
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: { ...LEAD_SELECT },
  })

  if (!lead) {
    throw new LeadNotFoundError(leadId)
  }

  const fromStatus = lead.status

  // 2. No-op if already at target
  if (fromStatus === newStatus) {
    return { changed: false, lead: lead as LeadDTO, previousStatus: fromStatus }
  }

  // 3. Enforce rules for automatic transitions
  const isAuto = trigger.startsWith('auto:')

  if (isAuto) {
    // Auto transitions never move OUT of terminal states
    if (isTerminal(fromStatus)) {
      return { changed: false, lead: lead as LeadDTO, previousStatus: fromStatus }
    }

    // Auto transitions INTO terminal states always apply
    if (!isTerminal(newStatus)) {
      // Check STATUS_ORDER: no downgrades
      const fromRank = statusRank(fromStatus)
      const toRank = statusRank(newStatus)
      if (fromRank !== undefined && toRank !== undefined && fromRank >= toRank) {
        return { changed: false, lead: lead as LeadDTO, previousStatus: fromStatus }
      }
    }
  }

  // 4. Execute transition in transaction
  const updatedLead = await prisma.$transaction(async (tx) => {
    const updated = await tx.lead.update({
      where: { id: leadId },
      data: { status: newStatus },
      select: { ...LEAD_SELECT },
    })

    await tx.leadStatusChange.create({
      data: {
        organizationId,
        leadId,
        fromStatus,
        toStatus: newStatus,
        trigger,
        actorClerkId: actorClerkId ?? null,
        metadata: metadata ?? undefined,
      },
    })

    // If moving to terminal state, stop active sequence enrollments
    if (isTerminal(newStatus)) {
      await tx.sequenceEnrollment.updateMany({
        where: { leadId, status: 'ACTIVE' },
        data: {
          status: 'STOPPED',
          stoppedAt: new Date(),
          stoppedReason: `lead_${newStatus.toLowerCase()}`,
        },
      })
    }

    return updated
  })

  return {
    changed: true,
    lead: updatedLead as LeadDTO,
    previousStatus: fromStatus,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/leads/server/transition-lead-status.test.ts`
Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/server/transition-lead-status.ts src/features/leads/server/transition-lead-status.test.ts
git commit -m "feat: add transitionLeadStatus() core engine with tests"
```

---

### Task 4: Manual Status Update Server Function + Route

**Files:**
- Create: `src/features/leads/server/update-lead-status.ts`
- Create: `src/app/api/leads/[id]/status/route.ts`
- Create: `src/app/api/leads/[id]/status/route.test.ts`

- [ ] **Step 1: Create update-lead-status.ts**

```typescript
import type { LeadStatus } from '@prisma/client'
import { transitionLeadStatus } from './transition-lead-status'
import type { TransitionResult } from '../types'

interface UpdateLeadStatusInput {
  organizationId: string
  leadId: string
  newStatus: LeadStatus
  actorClerkId: string
}

export async function updateLeadStatus({
  organizationId,
  leadId,
  newStatus,
  actorClerkId,
}: UpdateLeadStatusInput): Promise<TransitionResult> {
  return transitionLeadStatus({
    organizationId,
    leadId,
    newStatus,
    trigger: 'manual:user',
    actorClerkId,
    metadata: { source: 'pipeline_board' },
  })
}
```

- [ ] **Step 2: Create route.ts**

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { updateLeadStatus } from '@/features/leads/server/update-lead-status'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { LeadNotFoundError } from '@/features/leads/types'

const VALID_STATUSES = [
  'NEW', 'CONTACTED', 'REPLIED', 'INTERESTED', 'CONVERTED',
  'NOT_INTERESTED', 'UNSUBSCRIBED', 'BOUNCED',
] as const

type ValidStatus = (typeof VALID_STATUSES)[number]

function isValidStatus(s: string): s is ValidStatus {
  return (VALID_STATUSES as readonly string[]).includes(s)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await auth()

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: leadId } = await params

  let body: { status?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.status || !isValidStatus(body.status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  const org = await resolveOrganization(orgId)

  try {
    const result = await updateLeadStatus({
      organizationId: org.id,
      leadId,
      newStatus: body.status,
      actorClerkId: userId,
    })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof LeadNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/leads/server/update-lead-status.ts src/app/api/leads/\[id\]/status/route.ts
git commit -m "feat: add manual lead status update endpoint"
```

---

### Task 5: Integrate Auto-Transition in Reply Ingestion

**Files:**
- Modify: `src/features/replies/server/ingest-reply.ts`

- [ ] **Step 1: Add auto-transition call after reply persistence**

In `src/features/replies/server/ingest-reply.ts`, add the import at the top:

```typescript
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { CLASSIFICATION_TO_STATUS } from '@/features/leads/types'
```

Then, after the `prisma.inboundReply.create()` call (after `// 5. Persist`) and before the `return` statement, add:

```typescript
  // 6. Auto-transition lead status based on classification
  const targetStatus = CLASSIFICATION_TO_STATUS[classification]
  if (targetStatus) {
    await transitionLeadStatus({
      organizationId,
      leadId: lead.id,
      newStatus: targetStatus,
      trigger: 'auto:reply_classification',
      metadata: { replyId: reply.id, classification, confidence },
    })
  }
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `npx vitest run src/features/replies/server/ingest-reply.test.ts`
Expected: Tests may fail because the mock doesn't include `transitionLeadStatus`. Update the test file to mock it.

- [ ] **Step 3: Add mock for transitionLeadStatus in ingest-reply.test.ts**

Add this mock at the top of `src/features/replies/server/ingest-reply.test.ts` (after existing `vi.mock` calls):

```typescript
vi.mock('@/features/leads/server/transition-lead-status', () => ({
  transitionLeadStatus: vi.fn().mockResolvedValue({ changed: false, lead: {}, previousStatus: 'NEW' }),
}))

vi.mock('@/features/leads/types', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return {
    ...actual,
    CLASSIFICATION_TO_STATUS: {
      POSITIVE: 'INTERESTED',
      NEGATIVE: 'NOT_INTERESTED',
      OUT_OF_OFFICE: 'REPLIED',
      UNSUBSCRIBE_REQUEST: 'UNSUBSCRIBED',
      REFERRAL: 'REPLIED',
      NEUTRAL: 'REPLIED',
      UNKNOWN: 'REPLIED',
    },
  }
})
```

- [ ] **Step 4: Run all reply tests**

Run: `npx vitest run src/features/replies/server/ingest-reply.test.ts`
Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/replies/server/ingest-reply.ts src/features/replies/server/ingest-reply.test.ts
git commit -m "feat: auto-transition lead status on reply classification"
```

---

### Task 6: Integrate Auto-Transition + Terminal Check in Send Draft

**Files:**
- Modify: `src/features/messages/server/send-draft.ts`
- Modify: `src/features/messages/types.ts`

- [ ] **Step 1: Add LeadInTerminalStateError to messages/types.ts**

Add to the end of `src/features/messages/types.ts`:

```typescript
import type { LeadStatus } from '@prisma/client'

export class LeadInTerminalStateError extends Error {
  constructor(public readonly leadId: string, public readonly status: LeadStatus) {
    super(`Cannot send to lead ${leadId} in terminal state: ${status}`)
    this.name = 'LeadInTerminalStateError'
    Object.setPrototypeOf(this, LeadInTerminalStateError.prototype)
  }
}
```

- [ ] **Step 2: Add terminal check and auto-transition to send-draft.ts**

In `src/features/messages/server/send-draft.ts`, add imports at the top:

```typescript
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { TERMINAL_STATUSES } from '@/features/leads/types'
import { LeadInTerminalStateError } from '../types'
```

Update the draft fetch (step 1) to also include the lead's status:

Change `include: { lead: { select: { email: true } } }` to:
```typescript
include: { lead: { select: { id: true, email: true, status: true } } }
```

After `// 2. Must be APPROVED` check, add terminal state check:

```typescript
  // 2b. Check lead is not in terminal state
  if (TERMINAL_STATUSES.includes(draft.lead.status)) {
    throw new LeadInTerminalStateError(draft.leadId, draft.lead.status)
  }
```

After the transaction block (after the `catch` for P2002), before `// 7. Map to OutboundMessageDTO`, add:

```typescript
  // 6b. Auto-transition lead status: NEW → CONTACTED
  await transitionLeadStatus({
    organizationId,
    leadId: draft.leadId,
    newStatus: 'CONTACTED',
    trigger: 'auto:message_sent',
    metadata: { messageId: created.id, draftId },
  })
```

- [ ] **Step 3: Update route handler for new error**

In `src/app/api/drafts/[id]/send/route.ts`, add handling for `LeadInTerminalStateError`. Find the file and add:

```typescript
import { LeadInTerminalStateError } from '@/features/messages/types'
```

And in the error handling section, add before the generic throw:

```typescript
    if (err instanceof LeadInTerminalStateError) {
      return NextResponse.json(
        { error: err.message, code: 'LEAD_IN_TERMINAL_STATE' },
        { status: 422 },
      )
    }
```

- [ ] **Step 4: Update send-draft tests**

In `src/features/messages/server/send-draft.test.ts`, add a mock for the transition function:

```typescript
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
```

Also update any existing mock for `prisma.draft.findFirst` to include `lead: { id: 'lead-1', email: 'test@example.com', status: 'NEW' }` in the return value.

- [ ] **Step 5: Run send-draft tests**

Run: `npx vitest run src/features/messages/server/send-draft.test.ts`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/messages/server/send-draft.ts src/features/messages/types.ts src/features/messages/server/send-draft.test.ts src/app/api/drafts/\[id\]/send/route.ts
git commit -m "feat: add terminal state check and auto-transition on message send"
```

---

### Task 7: Pipeline Leads Query

**Files:**
- Create: `src/features/leads/server/get-pipeline-leads.ts`
- Create: `src/features/leads/server/get-pipeline-leads.test.ts`

- [ ] **Step 1: Write get-pipeline-leads.test.ts**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findMany: vi.fn() },
    outboundMessage: { groupBy: vi.fn() },
    inboundReply: { groupBy: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getPipelineLeads } from './get-pipeline-leads'

const mockLeadFindMany = prisma.lead.findMany as ReturnType<typeof vi.fn>
const mockMessageGroupBy = prisma.outboundMessage.groupBy as ReturnType<typeof vi.fn>
const mockReplyGroupBy = prisma.inboundReply.groupBy as ReturnType<typeof vi.fn>

const ORG = 'org-1'
const NOW = new Date('2026-04-08T12:00:00Z')

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getPipelineLeads', () => {
  it('returns leads with computed lastActivityAt', async () => {
    const leadDate = new Date('2026-04-01T00:00:00Z')
    const msgDate = new Date('2026-04-05T00:00:00Z')
    const replyDate = new Date('2026-04-07T00:00:00Z')

    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-1',
      firstName: 'Alice',
      lastName: 'Smith',
      email: 'alice@test.com',
      company: 'Acme',
      status: 'NEW',
      score: 80,
      updatedAt: leadDate,
    }])

    mockMessageGroupBy.mockResolvedValue([
      { leadId: 'lead-1', _max: { sentAt: msgDate } },
    ])

    mockReplyGroupBy.mockResolvedValue([
      { leadId: 'lead-1', _max: { receivedAt: replyDate } },
    ])

    const result = await getPipelineLeads({ organizationId: ORG })

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('lead-1')
    expect(result[0].lastActivityAt).toEqual(replyDate) // reply is latest
  })

  it('uses lead.updatedAt as fallback when no messages or replies', async () => {
    const leadDate = new Date('2026-04-01T00:00:00Z')

    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-2',
      firstName: null,
      lastName: null,
      email: 'bob@test.com',
      company: null,
      status: 'NEW',
      score: null,
      updatedAt: leadDate,
    }])

    mockMessageGroupBy.mockResolvedValue([])
    mockReplyGroupBy.mockResolvedValue([])

    const result = await getPipelineLeads({ organizationId: ORG })

    expect(result[0].lastActivityAt).toEqual(leadDate)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/leads/server/get-pipeline-leads.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement get-pipeline-leads.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { PipelineLeadDTO } from '../types'

interface GetPipelineLeadsInput {
  organizationId: string
}

export async function getPipelineLeads({
  organizationId,
}: GetPipelineLeadsInput): Promise<PipelineLeadDTO[]> {
  // 1. Fetch all leads for org
  const leads = await prisma.lead.findMany({
    where: { organizationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      company: true,
      status: true,
      score: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: 'desc' },
  })

  if (leads.length === 0) return []

  const leadIds = leads.map((l) => l.id)

  // 2. Get latest outbound activity per lead
  const messageActivity = await prisma.outboundMessage.groupBy({
    by: ['leadId'],
    where: { organizationId, leadId: { in: leadIds } },
    _max: { sentAt: true },
  })

  // 3. Get latest inbound activity per lead
  const replyActivity = await prisma.inboundReply.groupBy({
    by: ['leadId'],
    where: { organizationId, leadId: { in: leadIds } },
    _max: { receivedAt: true },
  })

  // 4. Build lookup maps
  const latestMessage = new Map(
    messageActivity.map((m) => [m.leadId, m._max.sentAt]),
  )
  const latestReply = new Map(
    replyActivity.map((r) => [r.leadId, r._max.receivedAt]),
  )

  // 5. Compute lastActivityAt and build DTOs
  return leads.map((lead) => {
    const msgDate = latestMessage.get(lead.id)
    const replyDate = latestReply.get(lead.id)

    const candidates = [lead.updatedAt]
    if (msgDate) candidates.push(msgDate)
    if (replyDate) candidates.push(replyDate)

    const lastActivityAt = new Date(
      Math.max(...candidates.map((d) => d.getTime())),
    )

    return {
      id: lead.id,
      firstName: lead.firstName,
      lastName: lead.lastName,
      email: lead.email,
      company: lead.company,
      status: lead.status,
      score: lead.score,
      lastActivityAt,
    }
  })
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/leads/server/get-pipeline-leads.test.ts`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/server/get-pipeline-leads.ts src/features/leads/server/get-pipeline-leads.test.ts
git commit -m "feat: add getPipelineLeads with lastActivityAt computation"
```

---

### Task 8: Install @dnd-kit Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dependencies**

Run:
```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site"
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @dnd-kit dependencies for pipeline board"
```

---

### Task 9: Pipeline Board Page + Client

**Files:**
- Create: `src/app/(dashboard)/pipeline/page.tsx`
- Create: `src/app/(dashboard)/pipeline/pipeline-client.tsx`

- [ ] **Step 1: Create the server page**

Create `src/app/(dashboard)/pipeline/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { PipelineClient } from './pipeline-client'
import { getPipelineLeads } from '@/features/leads/server/get-pipeline-leads'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function PipelinePage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const leads = await getPipelineLeads({ organizationId: org.id })

  return (
    <>
      <Header title="Pipeline" />
      <div className="flex-1 p-6 overflow-hidden">
        <PipelineClient initialLeads={leads} />
      </div>
    </>
  )
}
```

- [ ] **Step 2: Create the client orchestrator**

Create `src/app/(dashboard)/pipeline/pipeline-client.tsx`:

```tsx
'use client'

import { useState, useCallback } from 'react'
import { PipelineBoard } from '@/features/leads/components/pipeline-board'
import type { PipelineLeadDTO } from '@/features/leads/types'
import type { LeadStatus } from '@prisma/client'

interface PipelineClientProps {
  initialLeads: PipelineLeadDTO[]
}

export function PipelineClient({ initialLeads }: PipelineClientProps) {
  const [leads, setLeads] = useState<PipelineLeadDTO[]>(initialLeads)
  const [error, setError] = useState<string | null>(null)

  const handleStatusChange = useCallback(
    async (leadId: string, newStatus: LeadStatus) => {
      // Optimistic update
      const previousLeads = leads
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l)),
      )
      setError(null)

      try {
        const res = await fetch(`/api/leads/${leadId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error ?? 'Failed to update status')
        }
      } catch (err) {
        // Revert optimistic update
        setLeads(previousLeads)
        setError(err instanceof Error ? err.message : 'Failed to update status')
      }
    },
    [leads],
  )

  return (
    <div className="space-y-4 h-full">
      {error && (
        <div className="text-[var(--status-danger)] text-sm bg-[var(--status-danger-bg)] border border-[var(--status-danger)]/30 rounded-[var(--radius-btn)] px-4 py-2">
          {error}
        </div>
      )}
      <PipelineBoard leads={leads} onStatusChange={handleStatusChange} />
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/pipeline/page.tsx src/app/(dashboard)/pipeline/pipeline-client.tsx
git commit -m "feat: add pipeline page and client with optimistic status updates"
```

---

### Task 10: Pipeline Board Component (DnD)

**Files:**
- Create: `src/features/leads/components/pipeline-board.tsx`
- Create: `src/features/leads/components/pipeline-card.tsx`

- [ ] **Step 1: Create pipeline-card.tsx**

```tsx
'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@/components/ui/badge'
import type { PipelineLeadDTO } from '../types'

interface PipelineCardProps {
  lead: PipelineLeadDTO
}

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return `${Math.floor(diffDay / 30)}mo ago`
}

export function PipelineCard({ lead }: PipelineCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id, data: { lead } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const name =
    [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] p-3 cursor-grab active:cursor-grabbing shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)] transition-all duration-[var(--transition-base)]"
    >
      <p className="text-[var(--text-primary)] text-sm font-medium truncate">
        {name}
      </p>
      {lead.company && (
        <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">
          {lead.company}
        </p>
      )}
      <div className="flex items-center justify-between mt-2">
        {lead.score !== null ? (
          <Badge
            variant={
              lead.score >= 70
                ? 'success'
                : lead.score >= 40
                  ? 'warning'
                  : 'danger'
            }
          >
            {lead.score}
          </Badge>
        ) : (
          <span />
        )}
        <span className="text-[var(--text-muted)] text-xs">
          {formatRelativeTime(new Date(lead.lastActivityAt))}
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create pipeline-board.tsx**

```tsx
'use client'

import { useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { PipelineCard } from './pipeline-card'
import { PIPELINE_COLUMNS, TERMINAL_STATUSES } from '../types'
import type { PipelineLeadDTO } from '../types'
import type { LeadStatus } from '@prisma/client'

interface PipelineBoardProps {
  leads: PipelineLeadDTO[]
  onStatusChange: (leadId: string, newStatus: LeadStatus) => Promise<void>
}

const COLUMN_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  REPLIED: 'Replied',
  INTERESTED: 'Interested',
  CONVERTED: 'Converted',
  NOT_INTERESTED: 'Not Interested',
  UNSUBSCRIBED: 'Unsubscribed',
  BOUNCED: 'Bounced',
}

function DroppableColumn({
  status,
  leads,
}: {
  status: LeadStatus
  leads: PipelineLeadDTO[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div
      ref={setNodeRef}
      className={[
        'flex flex-col min-w-[220px] w-[220px] flex-shrink-0',
        'bg-[var(--bg-surface-raised)]/50 rounded-[var(--radius-card)] p-3',
        'border border-transparent transition-colors duration-[var(--transition-fast)]',
        isOver ? 'border-[var(--accent-indigo)]/40 bg-[var(--accent-indigo-glow)]/10' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wide">
          {COLUMN_LABELS[status] ?? status}
        </h3>
        <span className="text-[var(--text-muted)] text-xs tabular-nums">
          {leads.length}
        </span>
      </div>
      <SortableContext
        items={leads.map((l) => l.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2 min-h-[60px]">
          {leads.map((lead) => (
            <PipelineCard key={lead.id} lead={lead} />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

export function PipelineBoard({ leads, onStatusChange }: PipelineBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return

      const leadId = active.id as string

      // Determine which column was dropped into
      // over.id will be either a column status or another card id
      let targetStatus: LeadStatus | null = null

      // Check if dropped on a column directly
      if (
        PIPELINE_COLUMNS.includes(over.id as LeadStatus) ||
        TERMINAL_STATUSES.includes(over.id as LeadStatus)
      ) {
        targetStatus = over.id as LeadStatus
      } else {
        // Dropped on a card — find which column that card belongs to
        const targetLead = leads.find((l) => l.id === over.id)
        if (targetLead) {
          targetStatus = targetLead.status
        }
      }

      if (!targetStatus) return

      // Find source lead's current status
      const sourceLead = leads.find((l) => l.id === leadId)
      if (!sourceLead || sourceLead.status === targetStatus) return

      void onStatusChange(leadId, targetStatus)
    },
    [leads, onStatusChange],
  )

  // Group leads by status
  const grouped = new Map<LeadStatus, PipelineLeadDTO[]>()
  for (const status of [...PIPELINE_COLUMNS, ...TERMINAL_STATUSES]) {
    grouped.set(status, [])
  }
  for (const lead of leads) {
    const group = grouped.get(lead.status)
    if (group) {
      group.push(lead)
    }
  }

  // Sort each group by lastActivityAt DESC
  for (const group of grouped.values()) {
    group.sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() -
        new Date(a.lastActivityAt).getTime(),
    )
  }

  const exitedLeads = TERMINAL_STATUSES.flatMap(
    (s) => grouped.get(s) ?? [],
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {PIPELINE_COLUMNS.map((status) => (
          <DroppableColumn
            key={status}
            status={status}
            leads={grouped.get(status) ?? []}
          />
        ))}
      </div>

      {/* Exited leads section */}
      {exitedLeads.length > 0 && (
        <details className="mt-6">
          <summary className="text-[var(--text-muted)] text-xs uppercase tracking-wide font-medium cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
            Exited ({exitedLeads.length})
          </summary>
          <div className="flex gap-4 mt-3 overflow-x-auto pb-4">
            {TERMINAL_STATUSES.map((status) => {
              const statusLeads = grouped.get(status) ?? []
              if (statusLeads.length === 0) return null
              return (
                <DroppableColumn
                  key={status}
                  status={status}
                  leads={statusLeads}
                />
              )
            })}
          </div>
        </details>
      )}
    </DndContext>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/leads/components/pipeline-board.tsx src/features/leads/components/pipeline-card.tsx
git commit -m "feat: add pipeline board with drag-and-drop via @dnd-kit"
```

---

### Task 11: Add Pipeline to Sidebar

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Add Pipeline nav item**

In `src/components/layout/sidebar.tsx`, add `Kanban` to the lucide-react imports:

```typescript
import {
  LayoutDashboard,
  Users,
  Megaphone,
  GitBranch,
  Inbox,
  MessageSquare,
  BarChart2,
  FileText,
  Settings,
  Mail,
  ChevronLeft,
  ChevronRight,
  Kanban,
} from 'lucide-react'
```

Then add the Pipeline item to `NAV_ITEMS` after the Leads entry:

```typescript
const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/pipeline', icon: Kanban, label: 'Pipeline' },
  { href: '/drafts', icon: Mail, label: 'Drafts' },
  { href: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { href: '/sequences', icon: GitBranch, label: 'Sequences' },
  { href: '/inbox', icon: Inbox, label: 'Inbox' },
  { href: '/replies', icon: MessageSquare, label: 'Replies' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/templates', icon: FileText, label: 'Templates' },
] as const
```

- [ ] **Step 2: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: add Pipeline nav item to sidebar"
```

---

### Task 12: Build Verification + Full Test Run

- [ ] **Step 1: Run full build**

Run: `cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx next build 2>&1 | tail -20`
Expected: Build succeeds ("Compiled successfully").

- [ ] **Step 2: Run all tests**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass (existing + new).

- [ ] **Step 3: Fix any issues found**

If build or tests fail, diagnose and fix. Common issues:
- Missing Prisma client types after migration (run `npx prisma generate`)
- Import path mismatches
- Test mock shape doesn't match updated function signatures

- [ ] **Step 4: Final commit if fixes needed**

Only if step 3 required changes.
