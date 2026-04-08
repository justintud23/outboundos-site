# Sequence Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a sequence automation system: CRUD for sequences with steps, lead enrollment with terminal-state guards, a cron-driven runner that generates drafts for due steps (into the approval queue), stop conditions based on replies and terminal states, and a UI for managing sequences and enrollments.

**Architecture:** Sequences belong to campaigns. Leads are enrolled into sequences via SequenceEnrollment. A Vercel cron job (every 10 min) queries due enrollments, atomically claims them via a processing lock, checks stop conditions, then generates drafts linked to the sequence step. Drafts enter the existing approval workflow. The runner uses app-layer idempotency checks and stale-lock recovery. Sequence CRUD is restricted when active enrollments exist.

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL, TypeScript strict, Tailwind v4, clsx, lucide-react.

**Spec:** `docs/superpowers/specs/2026-04-08-three-features-design.md` (Feature 2 section)

**Prerequisites:** Feature 1 (Lead Pipeline) is complete. Schema migration already added SequenceEnrollment model, EnrollmentStatus enum, and sequenceEnrollmentId on Draft.

---

## File Structure

**Create:**
- `src/features/sequences/types.ts` — DTOs and error classes
- `src/features/sequences/server/create-sequence.ts` — create with steps
- `src/features/sequences/server/create-sequence.test.ts` — tests
- `src/features/sequences/server/get-sequences.ts` — list with counts
- `src/features/sequences/server/get-sequence.ts` — detail with steps + enrollments
- `src/features/sequences/server/update-sequence.ts` — update with active-enrollment guard
- `src/features/sequences/server/enroll-lead.ts` — enrollment with guards
- `src/features/sequences/server/enroll-lead.test.ts` — tests
- `src/features/sequences/server/get-enrollments.ts` — list enrollments
- `src/features/sequences/server/check-enrollment-stop.ts` — stop condition logic
- `src/features/sequences/server/check-enrollment-stop.test.ts` — tests
- `src/features/sequences/server/run-sequence-step.ts` — single step execution
- `src/features/sequences/server/run-sequence-step.test.ts` — tests
- `src/features/sequences/server/update-enrollment.ts` — pause/resume/stop
- `src/app/api/sequences/route.ts` — POST create
- `src/app/api/sequences/[id]/route.ts` — GET detail, PATCH update
- `src/app/api/sequences/[id]/enroll/route.ts` — POST enroll leads
- `src/app/api/sequences/enrollments/[id]/route.ts` — PATCH enrollment action
- `src/app/api/cron/sequence-runner/route.ts` — cron endpoint
- `src/app/(dashboard)/sequences/page.tsx` — replace placeholder
- `src/app/(dashboard)/sequences/sequences-client.tsx` — client orchestrator
- `src/app/(dashboard)/sequences/[id]/page.tsx` — detail page
- `src/app/(dashboard)/sequences/[id]/sequence-detail-client.tsx` — detail client
- `src/features/sequences/components/sequence-card.tsx` — card for list
- `src/features/sequences/components/enrollment-table.tsx` — enrollments table
- `src/features/sequences/components/create-sequence-form.tsx` — create form
- `src/features/sequences/components/enroll-modal.tsx` — enroll leads modal

**Modify:**
- `vercel.json` — add cron config (create if doesn't exist)

---

### Task 1: Sequence Types and DTOs

**Files:**
- Create: `src/features/sequences/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/features/sequences/types.ts`:

```typescript
import type { EnrollmentStatus } from '@prisma/client'

// ─── Sequence DTOs ──────────────────────────────────────────

export interface SequenceStepDTO {
  id: string
  stepNumber: number
  subject: string
  body: string
  delayDays: number
}

export interface SequenceDTO {
  id: string
  organizationId: string
  campaignId: string
  name: string
  stepCount: number
  activeEnrollments: number
  completedEnrollments: number
  stoppedEnrollments: number
  createdAt: Date
}

export interface SequenceDetailDTO extends SequenceDTO {
  steps: SequenceStepDTO[]
  campaignName: string
}

// ─── Enrollment DTOs ────────────────────────────────────────

export interface EnrollmentDTO {
  id: string
  leadId: string
  leadEmail: string
  leadName: string
  currentStepNumber: number
  totalSteps: number
  status: EnrollmentStatus
  nextDueAt: Date | null
  startedAt: Date
  stoppedReason: string | null
}

// ─── Step execution result ──────────────────────────────────

export type StepResult = 'DRAFT_GENERATED' | 'COMPLETED' | 'STOPPED' | 'SKIPPED' | 'ERROR'

// ─── Errors ─────────────────────────────────────────────────

export class SequenceNotFoundError extends Error {
  constructor(public readonly sequenceId: string) {
    super(`Sequence not found: ${sequenceId}`)
    this.name = 'SequenceNotFoundError'
    Object.setPrototypeOf(this, SequenceNotFoundError.prototype)
  }
}

export class SequenceHasNoStepsError extends Error {
  constructor(public readonly sequenceId: string) {
    super(`Sequence ${sequenceId} has no steps`)
    this.name = 'SequenceHasNoStepsError'
    Object.setPrototypeOf(this, SequenceHasNoStepsError.prototype)
  }
}

export class AlreadyEnrolledError extends Error {
  constructor(public readonly sequenceId: string, public readonly leadId: string) {
    super(`Lead ${leadId} is already enrolled in sequence ${sequenceId}`)
    this.name = 'AlreadyEnrolledError'
    Object.setPrototypeOf(this, AlreadyEnrolledError.prototype)
  }
}

export class EnrollmentNotFoundError extends Error {
  constructor(public readonly enrollmentId: string) {
    super(`Enrollment not found: ${enrollmentId}`)
    this.name = 'EnrollmentNotFoundError'
    Object.setPrototypeOf(this, EnrollmentNotFoundError.prototype)
  }
}

export class SequenceHasActiveEnrollmentsError extends Error {
  constructor(public readonly sequenceId: string) {
    super(`Cannot modify sequence ${sequenceId} — it has active enrollments`)
    this.name = 'SequenceHasActiveEnrollmentsError'
    Object.setPrototypeOf(this, SequenceHasActiveEnrollmentsError.prototype)
  }
}

// ─── Input types ────────────────────────────────────────────

export interface CreateSequenceInput {
  organizationId: string
  campaignId: string
  name: string
  steps: { stepNumber: number; subject: string; body: string; delayDays: number }[]
}

export interface EnrollLeadInput {
  organizationId: string
  sequenceId: string
  leadId: string
  actorClerkId: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/sequences/types.ts
git commit -m "feat: add sequence DTOs, error classes, and input types"
```

---

### Task 2: Create Sequence Server Function

**Files:**
- Create: `src/features/sequences/server/create-sequence.ts`
- Create: `src/features/sequences/server/create-sequence.test.ts`

- [ ] **Step 1: Write test**

Create `src/features/sequences/server/create-sequence.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    campaign: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { createSequence } from './create-sequence'

const mockCampaignFind = prisma.campaign.findFirst as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

const ORG = 'org-1'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('createSequence', () => {
  it('throws if campaign not found', async () => {
    mockCampaignFind.mockResolvedValue(null)

    await expect(
      createSequence({
        organizationId: ORG,
        campaignId: 'bad-id',
        name: 'Test Seq',
        steps: [{ stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0 }],
      }),
    ).rejects.toThrow('Campaign not found')
  })

  it('throws if no steps provided', async () => {
    mockCampaignFind.mockResolvedValue({ id: 'camp-1' })

    await expect(
      createSequence({
        organizationId: ORG,
        campaignId: 'camp-1',
        name: 'Test Seq',
        steps: [],
      }),
    ).rejects.toThrow('at least one step')
  })

  it('creates sequence with steps in transaction', async () => {
    mockCampaignFind.mockResolvedValue({ id: 'camp-1', name: 'Campaign 1' })

    const fakeSequence = {
      id: 'seq-1',
      organizationId: ORG,
      campaignId: 'camp-1',
      name: 'Test Seq',
      createdAt: new Date(),
      steps: [{ id: 'step-1', stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0 }],
    }

    mockTransaction.mockResolvedValue(fakeSequence)

    const result = await createSequence({
      organizationId: ORG,
      campaignId: 'camp-1',
      name: 'Test Seq',
      steps: [{ stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0 }],
    })

    expect(result.id).toBe('seq-1')
    expect(result.name).toBe('Test Seq')
    expect(result.stepCount).toBe(1)
    expect(result.campaignName).toBe('Campaign 1')
    expect(mockTransaction).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/sequences/server/create-sequence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement create-sequence.ts**

Create `src/features/sequences/server/create-sequence.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { SequenceDetailDTO, CreateSequenceInput } from '../types'

export async function createSequence(input: CreateSequenceInput): Promise<SequenceDetailDTO> {
  const { organizationId, campaignId, name, steps } = input

  // Validate campaign belongs to org
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true, name: true },
  })

  if (!campaign) {
    throw new Error('Campaign not found')
  }

  if (steps.length === 0) {
    throw new Error('Sequence must have at least one step')
  }

  // Create sequence + steps in transaction
  const sequence = await prisma.$transaction(async (tx) => {
    const seq = await tx.sequence.create({
      data: {
        organizationId,
        campaignId,
        name,
        steps: {
          create: steps.map((s) => ({
            stepNumber: s.stepNumber,
            subject: s.subject,
            body: s.body,
            delayDays: s.delayDays,
          })),
        },
      },
      include: {
        steps: {
          orderBy: { stepNumber: 'asc' },
        },
      },
    })

    await tx.auditLog.create({
      data: {
        organizationId,
        action: 'sequence.created',
        entityType: 'Sequence',
        entityId: seq.id,
        metadata: { name, stepCount: steps.length, campaignId },
      },
    })

    return seq
  })

  return {
    id: sequence.id,
    organizationId: sequence.organizationId,
    campaignId: sequence.campaignId,
    name: sequence.name,
    stepCount: sequence.steps.length,
    activeEnrollments: 0,
    completedEnrollments: 0,
    stoppedEnrollments: 0,
    createdAt: sequence.createdAt,
    steps: sequence.steps.map((s) => ({
      id: s.id,
      stepNumber: s.stepNumber,
      subject: s.subject,
      body: s.body,
      delayDays: s.delayDays,
    })),
    campaignName: campaign.name,
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/sequences/server/create-sequence.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/sequences/server/create-sequence.ts src/features/sequences/server/create-sequence.test.ts
git commit -m "feat: add createSequence server function with tests"
```

---

### Task 3: Get Sequences + Get Sequence Detail

**Files:**
- Create: `src/features/sequences/server/get-sequences.ts`
- Create: `src/features/sequences/server/get-sequence.ts`

- [ ] **Step 1: Create get-sequences.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { SequenceDTO } from '../types'

interface GetSequencesInput {
  organizationId: string
  campaignId?: string
}

export async function getSequences({
  organizationId,
  campaignId,
}: GetSequencesInput): Promise<{ sequences: SequenceDTO[]; total: number }> {
  const where = {
    organizationId,
    ...(campaignId && { campaignId }),
  }

  const rows = await prisma.sequence.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { steps: true } },
      enrollments: {
        select: { status: true },
      },
    },
  })

  const sequences: SequenceDTO[] = rows.map((row) => {
    const active = row.enrollments.filter((e) => e.status === 'ACTIVE').length
    const completed = row.enrollments.filter((e) => e.status === 'COMPLETED').length
    const stopped = row.enrollments.filter((e) => e.status === 'STOPPED').length

    return {
      id: row.id,
      organizationId: row.organizationId,
      campaignId: row.campaignId,
      name: row.name,
      stepCount: row._count.steps,
      activeEnrollments: active,
      completedEnrollments: completed,
      stoppedEnrollments: stopped,
      createdAt: row.createdAt,
    }
  })

  return { sequences, total: sequences.length }
}
```

- [ ] **Step 2: Create get-sequence.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { SequenceDetailDTO } from '../types'
import { SequenceNotFoundError } from '../types'

interface GetSequenceInput {
  organizationId: string
  sequenceId: string
}

export async function getSequence({
  organizationId,
  sequenceId,
}: GetSequenceInput): Promise<SequenceDetailDTO> {
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, organizationId },
    include: {
      campaign: { select: { name: true } },
      steps: { orderBy: { stepNumber: 'asc' } },
      enrollments: { select: { status: true } },
    },
  })

  if (!sequence) {
    throw new SequenceNotFoundError(sequenceId)
  }

  const active = sequence.enrollments.filter((e) => e.status === 'ACTIVE').length
  const completed = sequence.enrollments.filter((e) => e.status === 'COMPLETED').length
  const stopped = sequence.enrollments.filter((e) => e.status === 'STOPPED').length

  return {
    id: sequence.id,
    organizationId: sequence.organizationId,
    campaignId: sequence.campaignId,
    name: sequence.name,
    stepCount: sequence.steps.length,
    activeEnrollments: active,
    completedEnrollments: completed,
    stoppedEnrollments: stopped,
    createdAt: sequence.createdAt,
    steps: sequence.steps.map((s) => ({
      id: s.id,
      stepNumber: s.stepNumber,
      subject: s.subject,
      body: s.body,
      delayDays: s.delayDays,
    })),
    campaignName: sequence.campaign.name,
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/sequences/server/get-sequences.ts src/features/sequences/server/get-sequence.ts
git commit -m "feat: add getSequences and getSequence server functions"
```

---

### Task 4: Update Sequence + Get Enrollments

**Files:**
- Create: `src/features/sequences/server/update-sequence.ts`
- Create: `src/features/sequences/server/get-enrollments.ts`

- [ ] **Step 1: Create update-sequence.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { SequenceDetailDTO } from '../types'
import { SequenceNotFoundError, SequenceHasActiveEnrollmentsError } from '../types'
import { getSequence } from './get-sequence'

interface UpdateSequenceInput {
  organizationId: string
  sequenceId: string
  name?: string
  newSteps?: { stepNumber: number; subject: string; body: string; delayDays: number }[]
}

export async function updateSequence({
  organizationId,
  sequenceId,
  name,
  newSteps,
}: UpdateSequenceInput): Promise<SequenceDetailDTO> {
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, organizationId },
    include: {
      _count: { select: { steps: true } },
      enrollments: { where: { status: 'ACTIVE' }, select: { id: true } },
    },
  })

  if (!sequence) {
    throw new SequenceNotFoundError(sequenceId)
  }

  const hasActiveEnrollments = sequence.enrollments.length > 0

  // If active enrollments, only allow name change
  if (hasActiveEnrollments && newSteps && newSteps.length > 0) {
    throw new SequenceHasActiveEnrollmentsError(sequenceId)
  }

  await prisma.$transaction(async (tx) => {
    if (name) {
      await tx.sequence.update({
        where: { id: sequenceId },
        data: { name },
      })
    }

    if (newSteps && newSteps.length > 0 && !hasActiveEnrollments) {
      // Delete existing steps and recreate
      await tx.sequenceStep.deleteMany({ where: { sequenceId } })
      await tx.sequenceStep.createMany({
        data: newSteps.map((s) => ({
          sequenceId,
          stepNumber: s.stepNumber,
          subject: s.subject,
          body: s.body,
          delayDays: s.delayDays,
        })),
      })
    }
  })

  return getSequence({ organizationId, sequenceId })
}
```

- [ ] **Step 2: Create get-enrollments.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { EnrollmentStatus } from '@prisma/client'
import type { EnrollmentDTO } from '../types'

interface GetEnrollmentsInput {
  organizationId: string
  sequenceId: string
  status?: EnrollmentStatus
}

export async function getEnrollments({
  organizationId,
  sequenceId,
  status,
}: GetEnrollmentsInput): Promise<{ enrollments: EnrollmentDTO[]; total: number }> {
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, organizationId },
    select: { id: true, _count: { select: { steps: true } } },
  })

  if (!sequence) {
    return { enrollments: [], total: 0 }
  }

  const totalSteps = sequence._count.steps

  const rows = await prisma.sequenceEnrollment.findMany({
    where: {
      sequenceId,
      organizationId,
      ...(status && { status }),
    },
    include: {
      lead: {
        select: { email: true, firstName: true, lastName: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  const enrollments: EnrollmentDTO[] = rows.map((row) => ({
    id: row.id,
    leadId: row.leadId,
    leadEmail: row.lead.email,
    leadName: [row.lead.firstName, row.lead.lastName].filter(Boolean).join(' ') || row.lead.email,
    currentStepNumber: row.currentStepNumber,
    totalSteps,
    status: row.status,
    nextDueAt: row.nextDueAt,
    startedAt: row.startedAt,
    stoppedReason: row.stoppedReason,
  }))

  return { enrollments, total: enrollments.length }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/sequences/server/update-sequence.ts src/features/sequences/server/get-enrollments.ts
git commit -m "feat: add updateSequence and getEnrollments server functions"
```

---

### Task 5: Enroll Lead

**Files:**
- Create: `src/features/sequences/server/enroll-lead.ts`
- Create: `src/features/sequences/server/enroll-lead.test.ts`

- [ ] **Step 1: Write test**

Create `src/features/sequences/server/enroll-lead.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    sequence: { findFirst: vi.fn() },
    sequenceEnrollment: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { enrollLead } from './enroll-lead'
import { LeadInTerminalStateError } from '@/features/leads/types'
import { AlreadyEnrolledError, SequenceHasNoStepsError } from '../types'

const mockLeadFind = prisma.lead.findFirst as ReturnType<typeof vi.fn>
const mockSeqFind = prisma.sequence.findFirst as ReturnType<typeof vi.fn>
const mockEnrollFind = prisma.sequenceEnrollment.findFirst as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

const ORG = 'org-1'
const BASE_INPUT = { organizationId: ORG, sequenceId: 'seq-1', leadId: 'lead-1', actorClerkId: 'user-1' }

beforeEach(() => {
  vi.resetAllMocks()
})

describe('enrollLead', () => {
  it('throws if lead not found', async () => {
    mockLeadFind.mockResolvedValue(null)

    await expect(enrollLead(BASE_INPUT)).rejects.toThrow('Lead not found')
  })

  it('throws if lead is in terminal state', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'UNSUBSCRIBED' })

    await expect(enrollLead(BASE_INPUT)).rejects.toThrow(LeadInTerminalStateError)
  })

  it('throws if already enrolled', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'NEW' })
    mockSeqFind.mockResolvedValue({ id: 'seq-1', steps: [{ stepNumber: 1, delayDays: 0 }] })
    mockEnrollFind.mockResolvedValue({ id: 'existing' })

    await expect(enrollLead(BASE_INPUT)).rejects.toThrow(AlreadyEnrolledError)
  })

  it('throws if sequence has no steps', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'NEW' })
    mockSeqFind.mockResolvedValue({ id: 'seq-1', steps: [] })
    mockEnrollFind.mockResolvedValue(null)

    await expect(enrollLead(BASE_INPUT)).rejects.toThrow(SequenceHasNoStepsError)
  })

  it('creates enrollment with correct nextDueAt', async () => {
    mockLeadFind.mockResolvedValue({ id: 'lead-1', status: 'NEW' })
    mockSeqFind.mockResolvedValue({ id: 'seq-1', steps: [{ stepNumber: 1, delayDays: 3 }] })
    mockEnrollFind.mockResolvedValue(null)

    const fakeEnrollment = {
      id: 'enroll-1',
      organizationId: ORG,
      sequenceId: 'seq-1',
      leadId: 'lead-1',
      currentStepNumber: 0,
      status: 'ACTIVE',
      nextDueAt: new Date(),
      startedAt: new Date(),
      stoppedReason: null,
    }

    mockTransaction.mockResolvedValue(fakeEnrollment)

    const result = await enrollLead(BASE_INPUT)

    expect(result.id).toBe('enroll-1')
    expect(result.status).toBe('ACTIVE')
    expect(mockTransaction).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/sequences/server/enroll-lead.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement enroll-lead.ts**

Create `src/features/sequences/server/enroll-lead.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import { TERMINAL_STATUSES } from '@/features/leads/types'
import { LeadInTerminalStateError } from '@/features/leads/types'
import type { EnrollLeadInput } from '../types'
import { SequenceHasNoStepsError, AlreadyEnrolledError } from '../types'
import type { SequenceEnrollment } from '@prisma/client'

export async function enrollLead(input: EnrollLeadInput): Promise<SequenceEnrollment> {
  const { organizationId, sequenceId, leadId, actorClerkId } = input

  // 1. Validate lead exists and check terminal state
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: { id: true, status: true },
  })

  if (!lead) {
    throw new Error('Lead not found')
  }

  if (TERMINAL_STATUSES.includes(lead.status)) {
    throw new LeadInTerminalStateError(leadId, lead.status)
  }

  // 2. Fetch sequence with steps
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, organizationId },
    include: {
      steps: { orderBy: { stepNumber: 'asc' }, select: { stepNumber: true, delayDays: true } },
    },
  })

  if (!sequence) {
    throw new Error('Sequence not found')
  }

  if (sequence.steps.length === 0) {
    throw new SequenceHasNoStepsError(sequenceId)
  }

  // 3. Check for existing enrollment
  const existing = await prisma.sequenceEnrollment.findFirst({
    where: { sequenceId, leadId },
    select: { id: true },
  })

  if (existing) {
    throw new AlreadyEnrolledError(sequenceId, leadId)
  }

  // 4. Calculate nextDueAt from step 1's delayDays
  const step1 = sequence.steps[0]
  const now = new Date()
  const nextDueAt = new Date(now.getTime() + step1.delayDays * 24 * 60 * 60 * 1000)

  // 5. Create enrollment in transaction with audit log
  const enrollment = await prisma.$transaction(async (tx) => {
    const created = await tx.sequenceEnrollment.create({
      data: {
        organizationId,
        sequenceId,
        leadId,
        currentStepNumber: 0,
        status: 'ACTIVE',
        startedAt: now,
        nextDueAt,
      },
    })

    await tx.auditLog.create({
      data: {
        organizationId,
        actorClerkId,
        action: 'sequence.lead_enrolled',
        entityType: 'SequenceEnrollment',
        entityId: created.id,
        metadata: { sequenceId, leadId },
      },
    })

    return created
  })

  return enrollment
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/sequences/server/enroll-lead.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/sequences/server/enroll-lead.ts src/features/sequences/server/enroll-lead.test.ts
git commit -m "feat: add enrollLead with terminal state and duplicate guards"
```

---

### Task 6: Check Enrollment Stop + Update Enrollment

**Files:**
- Create: `src/features/sequences/server/check-enrollment-stop.ts`
- Create: `src/features/sequences/server/check-enrollment-stop.test.ts`
- Create: `src/features/sequences/server/update-enrollment.ts`

- [ ] **Step 1: Write stop check test**

Create `src/features/sequences/server/check-enrollment-stop.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    inboundReply: { findFirst: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { checkEnrollmentStop } from './check-enrollment-stop'

const mockReplyFind = prisma.inboundReply.findFirst as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
})

describe('checkEnrollmentStop', () => {
  it('returns shouldStop=true if lead is in terminal state', async () => {
    const result = await checkEnrollmentStop({
      enrollment: { startedAt: new Date('2026-01-01'), leadId: 'lead-1', organizationId: 'org-1' },
      leadStatus: 'UNSUBSCRIBED',
    })

    expect(result.shouldStop).toBe(true)
    expect(result.reason).toBe('lead_unsubscribed')
  })

  it('returns shouldStop=true if reply exists after enrollment started', async () => {
    mockReplyFind.mockResolvedValue({ id: 'reply-1' })

    const result = await checkEnrollmentStop({
      enrollment: { startedAt: new Date('2026-01-01'), leadId: 'lead-1', organizationId: 'org-1' },
      leadStatus: 'REPLIED',
    })

    expect(result.shouldStop).toBe(true)
    expect(result.reason).toBe('reply_received')
  })

  it('returns shouldStop=false if no stop conditions met', async () => {
    mockReplyFind.mockResolvedValue(null)

    const result = await checkEnrollmentStop({
      enrollment: { startedAt: new Date('2026-01-01'), leadId: 'lead-1', organizationId: 'org-1' },
      leadStatus: 'NEW',
    })

    expect(result.shouldStop).toBe(false)
  })
})
```

- [ ] **Step 2: Implement check-enrollment-stop.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { LeadStatus } from '@prisma/client'
import { TERMINAL_STATUSES } from '@/features/leads/types'

interface CheckStopInput {
  enrollment: { startedAt: Date; leadId: string; organizationId: string }
  leadStatus: LeadStatus
}

interface CheckStopResult {
  shouldStop: boolean
  reason?: string
}

export async function checkEnrollmentStop({
  enrollment,
  leadStatus,
}: CheckStopInput): Promise<CheckStopResult> {
  // 1. Terminal state check
  if (TERMINAL_STATUSES.includes(leadStatus)) {
    return { shouldStop: true, reason: `lead_${leadStatus.toLowerCase()}` }
  }

  // 2. Reply received after enrollment started
  const replyAfterStart = await prisma.inboundReply.findFirst({
    where: {
      leadId: enrollment.leadId,
      organizationId: enrollment.organizationId,
      createdAt: { gt: enrollment.startedAt },
    },
    select: { id: true },
  })

  if (replyAfterStart) {
    return { shouldStop: true, reason: 'reply_received' }
  }

  return { shouldStop: false }
}
```

- [ ] **Step 3: Implement update-enrollment.ts**

Create `src/features/sequences/server/update-enrollment.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { SequenceEnrollment } from '@prisma/client'
import { EnrollmentNotFoundError } from '../types'

interface UpdateEnrollmentInput {
  organizationId: string
  enrollmentId: string
  action: 'pause' | 'resume' | 'stop'
  actorClerkId: string
}

export async function updateEnrollment({
  organizationId,
  enrollmentId,
  action,
  actorClerkId,
}: UpdateEnrollmentInput): Promise<SequenceEnrollment> {
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId, organizationId },
  })

  if (!enrollment) {
    throw new EnrollmentNotFoundError(enrollmentId)
  }

  const now = new Date()

  const data =
    action === 'pause'
      ? { status: 'PAUSED' as const, pausedAt: now }
      : action === 'resume'
        ? { status: 'ACTIVE' as const, pausedAt: null }
        : { status: 'STOPPED' as const, stoppedAt: now, stoppedReason: 'manual' }

  const updated = await prisma.sequenceEnrollment.update({
    where: { id: enrollmentId },
    data,
  })

  await prisma.auditLog.create({
    data: {
      organizationId,
      actorClerkId,
      action: `sequence.enrollment_${action}`,
      entityType: 'SequenceEnrollment',
      entityId: enrollmentId,
    },
  })

  return updated
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/sequences/server/check-enrollment-stop.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/sequences/server/check-enrollment-stop.ts src/features/sequences/server/check-enrollment-stop.test.ts src/features/sequences/server/update-enrollment.ts
git commit -m "feat: add checkEnrollmentStop and updateEnrollment functions"
```

---

### Task 7: Run Sequence Step

**Files:**
- Create: `src/features/sequences/server/run-sequence-step.ts`
- Create: `src/features/sequences/server/run-sequence-step.test.ts`

- [ ] **Step 1: Write test**

Create `src/features/sequences/server/run-sequence-step.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequenceEnrollment: { findFirst: vi.fn(), update: vi.fn() },
    draft: { findFirst: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('./check-enrollment-stop', () => ({
  checkEnrollmentStop: vi.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { checkEnrollmentStop } from './check-enrollment-stop'
import { runSequenceStep } from './run-sequence-step'

const mockEnrollmentFind = prisma.sequenceEnrollment.findFirst as ReturnType<typeof vi.fn>
const mockCheckStop = checkEnrollmentStop as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

const ORG = 'org-1'

function makeEnrollment(overrides = {}) {
  return {
    id: 'enroll-1',
    organizationId: ORG,
    sequenceId: 'seq-1',
    leadId: 'lead-1',
    currentStepNumber: 0,
    status: 'ACTIVE',
    startedAt: new Date(),
    sequence: {
      campaignId: 'camp-1',
      steps: [
        { id: 'step-1', stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0 },
        { id: 'step-2', stepNumber: 2, subject: 'Follow up', body: 'Just checking', delayDays: 3 },
      ],
    },
    lead: { id: 'lead-1', status: 'NEW' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('runSequenceStep', () => {
  it('returns STOPPED if stop conditions are met', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment())
    mockCheckStop.mockResolvedValue({ shouldStop: true, reason: 'reply_received' })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })

    expect(result).toBe('STOPPED')
  })

  it('returns COMPLETED if no more steps', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ currentStepNumber: 2 }))
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })

    expect(result).toBe('COMPLETED')
  })

  it('returns DRAFT_GENERATED on successful step execution', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment())
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        draft: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'draft-1' }),
        },
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })

    expect(result).toBe('DRAFT_GENERATED')
  })

  it('returns SKIPPED if draft already exists for step', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment())
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      return fn({
        draft: {
          findFirst: vi.fn().mockResolvedValue({ id: 'existing-draft' }),
        },
        sequenceEnrollment: { update: vi.fn().mockResolvedValue({}) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      })
    })

    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })

    expect(result).toBe('SKIPPED')
  })
})
```

- [ ] **Step 2: Implement run-sequence-step.ts**

Create `src/features/sequences/server/run-sequence-step.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import { checkEnrollmentStop } from './check-enrollment-stop'
import type { StepResult } from '../types'

interface RunStepInput {
  enrollmentId: string
}

export async function runSequenceStep({ enrollmentId }: RunStepInput): Promise<StepResult> {
  // 1. Fetch enrollment with sequence, steps, and lead
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId },
    include: {
      sequence: {
        include: {
          steps: { orderBy: { stepNumber: 'asc' } },
        },
      },
      lead: { select: { id: true, status: true } },
    },
  })

  if (!enrollment) {
    return 'ERROR'
  }

  // 2. Check stop conditions
  const stopCheck = await checkEnrollmentStop({
    enrollment: {
      startedAt: enrollment.startedAt,
      leadId: enrollment.leadId,
      organizationId: enrollment.organizationId,
    },
    leadStatus: enrollment.lead.status,
  })

  if (stopCheck.shouldStop) {
    await prisma.$transaction(async (tx) => {
      await tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          status: 'STOPPED',
          stoppedAt: new Date(),
          stoppedReason: stopCheck.reason,
          processing: false,
        },
      })
    })
    return 'STOPPED'
  }

  // 3. Determine next step
  const nextStepNumber = enrollment.currentStepNumber + 1
  const nextStep = enrollment.sequence.steps.find((s) => s.stepNumber === nextStepNumber)

  if (!nextStep) {
    // All steps completed
    await prisma.$transaction(async (tx) => {
      await tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'COMPLETED', nextDueAt: null },
      })
    })
    return 'COMPLETED'
  }

  // 4. Execute in transaction: idempotency check, create draft, advance enrollment
  const result = await prisma.$transaction(async (tx) => {
    // Idempotency: check if draft already exists for this step
    const existingDraft = await tx.draft.findFirst({
      where: {
        sequenceId: enrollment.sequenceId,
        leadId: enrollment.leadId,
        sequenceStepId: nextStep.id,
      },
      select: { id: true },
    })

    if (existingDraft) {
      // Advance enrollment past this step anyway
      const followingStep = enrollment.sequence.steps.find((s) => s.stepNumber === nextStepNumber + 1)
      await tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: {
          currentStepNumber: nextStepNumber,
          nextDueAt: followingStep
            ? new Date(Date.now() + followingStep.delayDays * 24 * 60 * 60 * 1000)
            : null,
        },
      })
      return 'SKIPPED' as const
    }

    // Create draft
    await tx.draft.create({
      data: {
        organizationId: enrollment.organizationId,
        leadId: enrollment.leadId,
        campaignId: enrollment.sequence.campaignId,
        sequenceId: enrollment.sequenceId,
        sequenceStepId: nextStep.id,
        sequenceEnrollmentId: enrollment.id,
        subject: nextStep.subject,
        body: nextStep.body,
        status: 'PENDING_REVIEW',
      },
    })

    // Advance enrollment
    const followingStep = enrollment.sequence.steps.find((s) => s.stepNumber === nextStepNumber + 1)
    await tx.sequenceEnrollment.update({
      where: { id: enrollmentId },
      data: {
        currentStepNumber: nextStepNumber,
        nextDueAt: followingStep
          ? new Date(Date.now() + followingStep.delayDays * 24 * 60 * 60 * 1000)
          : null,
      },
    })

    await tx.auditLog.create({
      data: {
        organizationId: enrollment.organizationId,
        action: 'sequence.step_executed',
        entityType: 'SequenceEnrollment',
        entityId: enrollmentId,
        metadata: {
          sequenceId: enrollment.sequenceId,
          leadId: enrollment.leadId,
          stepNumber: nextStepNumber,
          stepId: nextStep.id,
        },
      },
    })

    return 'DRAFT_GENERATED' as const
  })

  return result
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/features/sequences/server/run-sequence-step.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/sequences/server/run-sequence-step.ts src/features/sequences/server/run-sequence-step.test.ts
git commit -m "feat: add runSequenceStep with idempotency and stop checks"
```

---

### Task 8: Cron Sequence Runner Route

**Files:**
- Create: `src/app/api/cron/sequence-runner/route.ts`
- Create or modify: `vercel.json`

- [ ] **Step 1: Create cron route**

Create `src/app/api/cron/sequence-runner/route.ts`:

```typescript
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { runSequenceStep } from '@/features/sequences/server/run-sequence-step'

const STALE_LOCK_MINUTES = 10
const BATCH_SIZE = 50

export async function POST(request: Request) {
  // Auth: verify CRON_SECRET
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()

  // 1. Recover stale locks
  const staleThreshold = new Date(now.getTime() - STALE_LOCK_MINUTES * 60 * 1000)
  await prisma.sequenceEnrollment.updateMany({
    where: {
      processing: true,
      processingStartedAt: { lt: staleThreshold },
    },
    data: { processing: false, processingStartedAt: null },
  })

  // 2. Query due enrollments
  const dueEnrollments = await prisma.sequenceEnrollment.findMany({
    where: {
      status: 'ACTIVE',
      nextDueAt: { lte: now },
      processing: false,
    },
    orderBy: { nextDueAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true },
  })

  const results: { enrollmentId: string; result: string }[] = []

  // 3. Process each enrollment
  for (const { id } of dueEnrollments) {
    // Atomic claim
    const claimed = await prisma.sequenceEnrollment.updateMany({
      where: { id, processing: false },
      data: { processing: true, processingStartedAt: now },
    })

    if (claimed.count === 0) {
      continue // Another instance claimed it
    }

    try {
      const result = await runSequenceStep({ enrollmentId: id })
      results.push({ enrollmentId: id, result })
    } catch (err) {
      console.error(`[sequence-runner] Error processing enrollment ${id}:`, err)
      results.push({ enrollmentId: id, result: 'ERROR' })
    } finally {
      // Always release lock
      await prisma.sequenceEnrollment.update({
        where: { id },
        data: { processing: false, processingStartedAt: null },
      })
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
    staleLockRecovery: true,
  })
}
```

- [ ] **Step 2: Create or update vercel.json**

Check if `vercel.json` exists. If not, create it. Add the cron configuration:

```json
{
  "crons": [
    {
      "path": "/api/cron/sequence-runner",
      "schedule": "*/10 * * * *"
    }
  ]
}
```

If vercel.json already exists, add the `crons` key to it.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/sequence-runner/route.ts vercel.json
git commit -m "feat: add cron-driven sequence runner with atomic locking"
```

---

### Task 9: Sequence API Routes

**Files:**
- Create: `src/app/api/sequences/route.ts`
- Create: `src/app/api/sequences/[id]/route.ts`
- Create: `src/app/api/sequences/[id]/enroll/route.ts`
- Create: `src/app/api/sequences/enrollments/[id]/route.ts`

- [ ] **Step 1: Create POST /api/sequences route**

Create `src/app/api/sequences/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { createSequence } from '@/features/sequences/server/create-sequence'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export async function POST(request: Request) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { campaignId?: string; name?: string; steps?: unknown[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.campaignId || !body.name || !Array.isArray(body.steps) || body.steps.length === 0) {
    return NextResponse.json({ error: 'campaignId, name, and at least one step are required' }, { status: 400 })
  }

  const org = await resolveOrganization(orgId)

  try {
    const sequence = await createSequence({
      organizationId: org.id,
      campaignId: body.campaignId,
      name: body.name,
      steps: body.steps as { stepNumber: number; subject: string; body: string; delayDays: number }[],
    })
    return NextResponse.json(sequence, { status: 201 })
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
```

- [ ] **Step 2: Create GET/PATCH /api/sequences/[id] route**

Create `src/app/api/sequences/[id]/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getSequence } from '@/features/sequences/server/get-sequence'
import { updateSequence } from '@/features/sequences/server/update-sequence'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { SequenceNotFoundError, SequenceHasActiveEnrollmentsError } from '@/features/sequences/types'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const org = await resolveOrganization(orgId)

  try {
    const sequence = await getSequence({ organizationId: org.id, sequenceId: id })
    return NextResponse.json(sequence)
  } catch (err) {
    if (err instanceof SequenceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const org = await resolveOrganization(orgId)

  let body: { name?: string; steps?: unknown[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const sequence = await updateSequence({
      organizationId: org.id,
      sequenceId: id,
      name: body.name,
      newSteps: body.steps as { stepNumber: number; subject: string; body: string; delayDays: number }[] | undefined,
    })
    return NextResponse.json(sequence)
  } catch (err) {
    if (err instanceof SequenceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof SequenceHasActiveEnrollmentsError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    throw err
  }
}
```

- [ ] **Step 3: Create POST /api/sequences/[id]/enroll route**

Create `src/app/api/sequences/[id]/enroll/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { enrollLead } from '@/features/sequences/server/enroll-lead'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { LeadInTerminalStateError } from '@/features/leads/types'
import { AlreadyEnrolledError, SequenceHasNoStepsError } from '@/features/sequences/types'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: sequenceId } = await params
  const org = await resolveOrganization(orgId)

  let body: { leadIds?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ error: 'leadIds array is required' }, { status: 400 })
  }

  const results: { leadId: string; success: boolean; error?: string; enrollmentId?: string }[] = []

  for (const leadId of body.leadIds) {
    try {
      const enrollment = await enrollLead({
        organizationId: org.id,
        sequenceId,
        leadId,
        actorClerkId: userId,
      })
      results.push({ leadId, success: true, enrollmentId: enrollment.id })
    } catch (err) {
      if (err instanceof LeadInTerminalStateError) {
        results.push({ leadId, success: false, error: 'Lead is in terminal state' })
      } else if (err instanceof AlreadyEnrolledError) {
        results.push({ leadId, success: false, error: 'Already enrolled' })
      } else if (err instanceof SequenceHasNoStepsError) {
        results.push({ leadId, success: false, error: 'Sequence has no steps' })
      } else {
        results.push({ leadId, success: false, error: 'Failed to enroll' })
      }
    }
  }

  const successCount = results.filter((r) => r.success).length
  return NextResponse.json({ results, enrolled: successCount, total: body.leadIds.length }, { status: 201 })
}
```

- [ ] **Step 4: Create PATCH /api/sequences/enrollments/[id] route**

Create `src/app/api/sequences/enrollments/[id]/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { updateEnrollment } from '@/features/sequences/server/update-enrollment'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { EnrollmentNotFoundError } from '@/features/sequences/types'

const VALID_ACTIONS = ['pause', 'resume', 'stop'] as const

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: enrollmentId } = await params
  const org = await resolveOrganization(orgId)

  let body: { action?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.action || !(VALID_ACTIONS as readonly string[]).includes(body.action)) {
    return NextResponse.json(
      { error: `action must be one of: ${VALID_ACTIONS.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const enrollment = await updateEnrollment({
      organizationId: org.id,
      enrollmentId,
      action: body.action as 'pause' | 'resume' | 'stop',
      actorClerkId: userId,
    })
    return NextResponse.json(enrollment)
  } catch (err) {
    if (err instanceof EnrollmentNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/sequences/route.ts "src/app/api/sequences/[id]/route.ts" "src/app/api/sequences/[id]/enroll/route.ts" "src/app/api/sequences/enrollments/[id]/route.ts"
git commit -m "feat: add sequence CRUD and enrollment API routes"
```

---

### Task 10: Sequence List Page + Client

**Files:**
- Modify: `src/app/(dashboard)/sequences/page.tsx` (replace placeholder)
- Create: `src/app/(dashboard)/sequences/sequences-client.tsx`
- Create: `src/features/sequences/components/sequence-card.tsx`
- Create: `src/features/sequences/components/create-sequence-form.tsx`

- [ ] **Step 1: Create sequence-card.tsx**

Create `src/features/sequences/components/sequence-card.tsx`:

```tsx
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { SequenceDTO } from '../types'

export function SequenceCard({ sequence }: { sequence: SequenceDTO }) {
  const totalEnrollments = sequence.activeEnrollments + sequence.completedEnrollments + sequence.stoppedEnrollments

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5 flex flex-col gap-3 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)] transition-all duration-[var(--transition-base)]">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/sequences/${sequence.id}`}
          className="text-[var(--text-primary)] font-semibold text-sm leading-snug hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          {sequence.name}
        </Link>
        <Badge variant="muted">{sequence.stepCount} step{sequence.stepCount !== 1 ? 's' : ''}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 py-2 border-t border-[var(--border-subtle)]">
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Active</p>
          <p className="text-[var(--status-success)] text-sm font-medium tabular-nums">{sequence.activeEnrollments}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Completed</p>
          <p className="text-[var(--text-primary)] text-sm font-medium tabular-nums">{sequence.completedEnrollments}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Stopped</p>
          <p className="text-[var(--text-secondary)] text-sm font-medium tabular-nums">{sequence.stoppedEnrollments}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[var(--text-muted)] text-xs">
          {totalEnrollments} enrolled
        </span>
        <Link
          href={`/sequences/${sequence.id}`}
          className="text-[var(--accent-indigo)] text-xs hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          View Details &rarr;
        </Link>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create create-sequence-form.tsx**

Create `src/features/sequences/components/create-sequence-form.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface StepForm {
  subject: string
  body: string
  delayDays: number
}

interface CreateSequenceFormProps {
  campaigns: { id: string; name: string }[]
  onCreated: () => void
}

export function CreateSequenceForm({ campaigns, onCreated }: CreateSequenceFormProps) {
  const [name, setName] = useState('')
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '')
  const [steps, setSteps] = useState<StepForm[]>([{ subject: '', body: '', delayDays: 0 }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addStep() {
    setSteps((prev) => [...prev, { subject: '', body: '', delayDays: 3 }])
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }

  function updateStep(index: number, field: keyof StepForm, value: string | number) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await fetch('/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId,
        name,
        steps: steps.map((s, i) => ({
          stepNumber: i + 1,
          subject: s.subject,
          body: s.body,
          delayDays: s.delayDays,
        })),
      }),
    })

    setSaving(false)

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? 'Failed to create sequence')
      return
    }

    onCreated()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-3">
        <Input
          placeholder="Sequence name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="flex-1"
        />
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className="bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] text-sm rounded-[var(--radius-btn)] px-3 py-2 focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)]"
          required
        >
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        <h4 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wide">Steps</h4>
        {steps.map((step, i) => (
          <div key={i} className="bg-[var(--bg-surface-raised)] rounded-[var(--radius-btn)] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] text-xs font-medium">Step {i + 1}</span>
              <div className="flex items-center gap-2">
                <label className="text-[var(--text-muted)] text-xs">
                  Delay:
                  <input
                    type="number"
                    min={0}
                    value={step.delayDays}
                    onChange={(e) => updateStep(i, 'delayDays', parseInt(e.target.value) || 0)}
                    className="w-14 ml-1 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] text-xs rounded px-2 py-1"
                  />
                  d
                </label>
                {steps.length > 1 && (
                  <button type="button" onClick={() => removeStep(i)} className="text-[var(--text-muted)] hover:text-[var(--status-danger)] transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <Input
              placeholder="Subject line"
              value={step.subject}
              onChange={(e) => updateStep(i, 'subject', e.target.value)}
              required
            />
            <textarea
              placeholder="Email body"
              value={step.body}
              onChange={(e) => updateStep(i, 'body', e.target.value)}
              rows={3}
              required
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] resize-none"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addStep}
          className="flex items-center gap-1.5 text-xs text-[var(--accent-indigo)] hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          <Plus size={14} />
          Add step
        </button>
      </div>

      {error && <p className="text-[var(--status-danger)] text-xs">{error}</p>}

      <Button type="submit" variant="primary" size="sm" disabled={saving}>
        {saving ? 'Creating\u2026' : 'Create Sequence'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 3: Replace sequences page.tsx**

Replace `src/app/(dashboard)/sequences/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { SequencesClient } from './sequences-client'
import { getSequences } from '@/features/sequences/server/get-sequences'
import { getCampaigns } from '@/features/campaigns/server/get-campaigns'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function SequencesPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const [{ sequences }, { campaigns }] = await Promise.all([
    getSequences({ organizationId: org.id }),
    getCampaigns({ organizationId: org.id }),
  ])

  return (
    <>
      <Header title="Sequences" />
      <div className="flex-1 p-6">
        <SequencesClient
          initialSequences={sequences}
          campaigns={campaigns.map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>
    </>
  )
}
```

- [ ] **Step 4: Create sequences-client.tsx**

Create `src/app/(dashboard)/sequences/sequences-client.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { SequenceCard } from '@/features/sequences/components/sequence-card'
import { CreateSequenceForm } from '@/features/sequences/components/create-sequence-form'
import type { SequenceDTO } from '@/features/sequences/types'

interface SequencesClientProps {
  initialSequences: SequenceDTO[]
  campaigns: { id: string; name: string }[]
}

export function SequencesClient({ initialSequences, campaigns }: SequencesClientProps) {
  const [sequences, setSequences] = useState(initialSequences)
  const [showCreate, setShowCreate] = useState(false)

  async function handleCreated() {
    setShowCreate(false)
    // Refresh sequences
    const res = await fetch('/api/sequences?_=' + Date.now())
    // For now, just reload the page to get fresh server data
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-[var(--text-secondary)] text-sm">
          {sequences.length} sequence{sequences.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-3 py-1.5 rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] text-white hover:bg-[var(--accent-indigo-hover)] transition-colors font-medium"
        >
          {showCreate ? 'Cancel' : 'Create Sequence'}
        </button>
      </div>

      {showCreate && campaigns.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)]">
          <h3 className="text-[var(--text-primary)] text-sm font-medium mb-4">New Sequence</h3>
          <CreateSequenceForm campaigns={campaigns} onCreated={handleCreated} />
        </div>
      )}

      {showCreate && campaigns.length === 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5">
          <p className="text-[var(--text-muted)] text-sm">Create a campaign first before adding sequences.</p>
        </div>
      )}

      {sequences.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[var(--text-muted)] text-sm">No sequences yet.</p>
          <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">
            Create a sequence to automate your outreach follow-ups.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sequences.map((seq) => (
            <SequenceCard key={seq.id} sequence={seq} />
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/app/(dashboard)/sequences/page.tsx src/app/(dashboard)/sequences/sequences-client.tsx src/features/sequences/components/sequence-card.tsx src/features/sequences/components/create-sequence-form.tsx
git commit -m "feat: add sequence list page with create form"
```

---

### Task 11: Sequence Detail Page

**Files:**
- Create: `src/app/(dashboard)/sequences/[id]/page.tsx`
- Create: `src/app/(dashboard)/sequences/[id]/sequence-detail-client.tsx`
- Create: `src/features/sequences/components/enrollment-table.tsx`
- Create: `src/features/sequences/components/enroll-modal.tsx`

- [ ] **Step 1: Create enrollment-table.tsx**

Create `src/features/sequences/components/enrollment-table.tsx`:

```tsx
'use client'

import { Badge } from '@/components/ui/badge'
import type { EnrollmentDTO } from '../types'
import type { EnrollmentStatus } from '@prisma/client'

const STATUS_VARIANT: Record<EnrollmentStatus, 'success' | 'warning' | 'muted' | 'danger'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'muted',
  STOPPED: 'danger',
}

interface EnrollmentTableProps {
  enrollments: EnrollmentDTO[]
  onAction: (enrollmentId: string, action: 'pause' | 'resume' | 'stop') => Promise<void>
}

export function EnrollmentTable({ enrollments, onAction }: EnrollmentTableProps) {
  if (enrollments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[var(--text-secondary)] text-sm">No leads enrolled yet.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)]">
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Lead</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Step</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden md:table-cell">Next Due</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map((enrollment) => (
            <tr key={enrollment.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]">
              <td className="py-3 px-4">
                <div className="text-[var(--text-primary)] font-medium">{enrollment.leadName}</div>
                <div className="text-[var(--text-muted)] text-xs">{enrollment.leadEmail}</div>
              </td>
              <td className="py-3 px-4 text-[var(--text-secondary)] text-xs tabular-nums">
                {enrollment.currentStepNumber}/{enrollment.totalSteps}
              </td>
              <td className="py-3 px-4">
                <Badge variant={STATUS_VARIANT[enrollment.status]}>
                  {enrollment.status}
                </Badge>
                {enrollment.stoppedReason && (
                  <span className="text-[var(--text-muted)] text-xs ml-1">({enrollment.stoppedReason})</span>
                )}
              </td>
              <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden md:table-cell">
                {enrollment.nextDueAt
                  ? new Date(enrollment.nextDueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : '\u2014'}
              </td>
              <td className="py-3 px-4">
                {enrollment.status === 'ACTIVE' && (
                  <div className="flex gap-2">
                    <button onClick={() => void onAction(enrollment.id, 'pause')} className="text-xs text-[var(--status-warning)] hover:underline">Pause</button>
                    <button onClick={() => void onAction(enrollment.id, 'stop')} className="text-xs text-[var(--status-danger)] hover:underline">Stop</button>
                  </div>
                )}
                {enrollment.status === 'PAUSED' && (
                  <button onClick={() => void onAction(enrollment.id, 'resume')} className="text-xs text-[var(--status-success)] hover:underline">Resume</button>
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

- [ ] **Step 2: Create enroll-modal.tsx**

Create `src/features/sequences/components/enroll-modal.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { LeadStatus } from '@prisma/client'
import { TERMINAL_STATUSES } from '@/features/leads/types'

interface LeadOption {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  status: LeadStatus
}

interface EnrollModalProps {
  sequenceId: string
  leads: LeadOption[]
  enrolledLeadIds: Set<string>
  onClose: () => void
  onEnrolled: () => void
}

export function EnrollModal({ sequenceId, leads, enrolledLeadIds, onClose, onEnrolled }: EnrollModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [enrolling, setEnrolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleLead(leadId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(leadId)) {
        next.delete(leadId)
      } else {
        next.add(leadId)
      }
      return next
    })
  }

  async function handleEnroll() {
    setEnrolling(true)
    setError(null)

    const res = await fetch(`/api/sequences/${sequenceId}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: Array.from(selected) }),
    })

    setEnrolling(false)

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? 'Failed to enroll leads')
      return
    }

    onEnrolled()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40" onClick={onClose} aria-hidden="true" />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-[var(--bg-base)] border-l border-[var(--border-default)] z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h2 className="text-[var(--text-primary)] font-semibold text-sm">Enroll Leads</h2>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] text-lg">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-1">
            {leads.map((lead) => {
              const isTerminal = TERMINAL_STATUSES.includes(lead.status)
              const isEnrolled = enrolledLeadIds.has(lead.id)
              const disabled = isTerminal || isEnrolled
              const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email

              return (
                <label
                  key={lead.id}
                  className={`flex items-center gap-3 px-3 py-2 rounded-[var(--radius-btn)] transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[var(--bg-surface-raised)] cursor-pointer'}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onChange={() => !disabled && toggleLead(lead.id)}
                    disabled={disabled}
                    className="accent-[var(--accent-indigo)]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-[var(--text-primary)] text-sm truncate">{name}</p>
                    <p className="text-[var(--text-muted)] text-xs truncate">{lead.email}</p>
                  </div>
                  {isTerminal && <span className="text-[var(--text-muted)] text-xs">Terminal</span>}
                  {isEnrolled && <span className="text-[var(--text-muted)] text-xs">Enrolled</span>}
                </label>
              )
            })}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[var(--border-default)]">
          {error && <p className="text-[var(--status-danger)] text-xs mb-2">{error}</p>}
          <Button
            variant="primary"
            size="sm"
            onClick={handleEnroll}
            disabled={enrolling || selected.size === 0}
          >
            {enrolling ? 'Enrolling\u2026' : `Enroll ${selected.size} Lead${selected.size !== 1 ? 's' : ''}`}
          </Button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Create detail page**

Create `src/app/(dashboard)/sequences/[id]/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect, notFound } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { SequenceDetailClient } from './sequence-detail-client'
import { getSequence } from '@/features/sequences/server/get-sequence'
import { getEnrollments } from '@/features/sequences/server/get-enrollments'
import { getLeads } from '@/features/leads/server/get-leads'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { orgId } = await auth()
  if (!orgId) redirect('/dashboard')

  const { id } = await params
  const org = await resolveOrganization(orgId)

  let sequence
  try {
    sequence = await getSequence({ organizationId: org.id, sequenceId: id })
  } catch {
    notFound()
  }

  const [{ enrollments }, { leads }] = await Promise.all([
    getEnrollments({ organizationId: org.id, sequenceId: id }),
    getLeads({ organizationId: org.id, limit: 200 }),
  ])

  return (
    <>
      <Header title={sequence.name} />
      <div className="flex-1 p-6">
        <SequenceDetailClient
          sequence={sequence}
          initialEnrollments={enrollments}
          leads={leads.map((l) => ({
            id: l.id,
            email: l.email,
            firstName: l.firstName,
            lastName: l.lastName,
            status: l.status,
          }))}
        />
      </div>
    </>
  )
}
```

- [ ] **Step 4: Create sequence-detail-client.tsx**

Create `src/app/(dashboard)/sequences/[id]/sequence-detail-client.tsx`:

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { EnrollmentTable } from '@/features/sequences/components/enrollment-table'
import { EnrollModal } from '@/features/sequences/components/enroll-modal'
import type { SequenceDetailDTO, EnrollmentDTO } from '@/features/sequences/types'
import type { LeadStatus } from '@prisma/client'

interface SequenceDetailClientProps {
  sequence: SequenceDetailDTO
  initialEnrollments: EnrollmentDTO[]
  leads: { id: string; email: string; firstName: string | null; lastName: string | null; status: LeadStatus }[]
}

export function SequenceDetailClient({ sequence, initialEnrollments, leads }: SequenceDetailClientProps) {
  const [enrollments, setEnrollments] = useState(initialEnrollments)
  const [showEnroll, setShowEnroll] = useState(false)

  const enrolledLeadIds = new Set(enrollments.map((e) => e.leadId))

  async function handleEnrollmentAction(enrollmentId: string, action: 'pause' | 'resume' | 'stop') {
    const res = await fetch(`/api/sequences/enrollments/${enrollmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })

    if (res.ok) {
      // Refresh
      window.location.reload()
    }
  }

  function handleEnrolled() {
    setShowEnroll(false)
    window.location.reload()
  }

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link href="/sequences" className="text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors">
        &larr; Sequences
      </Link>

      {/* Steps timeline */}
      <div>
        <h2 className="text-[var(--text-primary)] font-semibold text-sm mb-3">Steps</h2>
        <div className="flex flex-col gap-2">
          {sequence.steps.map((step, i) => (
            <div key={step.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)] flex items-center justify-center text-xs font-medium">
                  {step.stepNumber}
                </div>
                {i < sequence.steps.length - 1 && (
                  <div className="w-px h-8 bg-[var(--border-default)]" />
                )}
              </div>
              <div className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] p-3">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[var(--text-primary)] text-sm font-medium">{step.subject}</p>
                  {step.delayDays > 0 && (
                    <Badge variant="muted">+{step.delayDays}d</Badge>
                  )}
                </div>
                <p className="text-[var(--text-muted)] text-xs line-clamp-2">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Enrollments */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[var(--text-primary)] font-semibold text-sm">
            Enrolled Leads
            <span className="ml-2 text-[var(--text-muted)] font-normal">{enrollments.length}</span>
          </h2>
          <button
            onClick={() => setShowEnroll(true)}
            className="text-xs px-3 py-1.5 rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] text-white hover:bg-[var(--accent-indigo-hover)] transition-colors font-medium"
          >
            Enroll Leads
          </button>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
          <EnrollmentTable enrollments={enrollments} onAction={handleEnrollmentAction} />
        </div>
      </div>

      {/* Enroll modal */}
      {showEnroll && (
        <EnrollModal
          sequenceId={sequence.id}
          leads={leads}
          enrolledLeadIds={enrolledLeadIds}
          onClose={() => setShowEnroll(false)}
          onEnrolled={handleEnrolled}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add "src/app/(dashboard)/sequences/[id]/page.tsx" "src/app/(dashboard)/sequences/[id]/sequence-detail-client.tsx" src/features/sequences/components/enrollment-table.tsx src/features/sequences/components/enroll-modal.tsx
git commit -m "feat: add sequence detail page with enrollment management"
```

---

### Task 12: Build Verification + Full Test Run

- [ ] **Step 1: Run full build**

Run: `cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass (existing + new).

- [ ] **Step 3: Fix any issues**

Common issues:
- TypeScript errors from new Prisma types not matching
- Import path mismatches
- Missing mock updates in existing tests

- [ ] **Step 4: Final commit if fixes needed**
