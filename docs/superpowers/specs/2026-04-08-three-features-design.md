# OutboundOS — Three Major Features Design Spec

**Date:** 2026-04-08
**Scope:** Lead Pipeline Automation, Sequence Automation, Inbox View
**Approach:** Three independent features designed together (shared schema migration), implemented sequentially: Feature 1 → 2 → 3.

---

## Implementation Order

1. **Feature 1: Lead State + Pipeline Automation** — foundation for everything else. Status transitions, audit trail, Kanban board.
2. **Feature 2: Sequence Automation** — depends on Feature 1's `transitionLeadStatus()` and terminal state enforcement.
3. **Feature 3: Inbox View** — depends on existing messages/replies data. Independent of sequences but benefits from pipeline status display.

---

## Shared Schema Migration

All schema changes ship in one Prisma migration to avoid multiple migration steps.

### Enum Additions

```prisma
enum LeadStatus {
  NEW
  CONTACTED
  REPLIED
  BOUNCED
  UNSUBSCRIBED
  CONVERTED
  INTERESTED        // NEW
  NOT_INTERESTED     // NEW
}

enum EnrollmentStatus {  // NEW
  ACTIVE
  PAUSED
  COMPLETED
  STOPPED
}
```

### New Models

```prisma
model LeadStatusChange {
  id              String     @id @default(cuid())
  organizationId  String
  leadId          String
  fromStatus      LeadStatus
  toStatus        LeadStatus
  trigger         String     // "auto:reply_classification", "auto:message_sent", "manual:user"
  actorClerkId    String?    // null for automated changes
  metadata        Json?      // debugging/analytics context
  createdAt       DateTime   @default(now())

  organization    Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  lead            Lead         @relation(fields: [leadId], references: [id], onDelete: Cascade)

  @@index([organizationId])
  @@index([leadId])
  @@index([organizationId, leadId])
}

model SequenceEnrollment {
  id                  String           @id @default(cuid())
  organizationId      String
  sequenceId          String
  leadId              String
  currentStepNumber   Int              @default(0)    // last completed step (0 = not started)
  status              EnrollmentStatus @default(ACTIVE)
  nextDueAt           DateTime?
  processing          Boolean          @default(false)
  processingStartedAt DateTime?
  startedAt           DateTime         @default(now())
  pausedAt            DateTime?
  stoppedAt           DateTime?
  stoppedReason       String?          // "reply_received", "lead_unsubscribed", "lead_not_interested", "manual", "lead_bounced"
  createdAt           DateTime         @default(now())
  updatedAt           DateTime         @updatedAt

  organization        Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  sequence            Sequence         @relation(fields: [sequenceId], references: [id], onDelete: Cascade)
  lead                Lead             @relation(fields: [leadId], references: [id], onDelete: Cascade)

  @@unique([sequenceId, leadId])
  @@index([organizationId])
  @@index([status, nextDueAt])
  @@index([leadId])
}
```

### Model Modifications

**InboundReply — add:**
```prisma
isRead    Boolean  @default(false)

@@index([organizationId, isRead])
```

**Draft — add unique constraint for idempotency:**
```prisma
@@unique([sequenceId, leadId])  // already has sequenceId and leadId fields
```

Note: The Draft model already has `sequenceId` and `sequenceStepId` optional fields. For sequence runner idempotency, we check for existing drafts with matching (sequenceId, leadId, sequenceStepId) before generating. No schema change needed — this is an app-layer check.

### Relations to Add

- `Lead` → `LeadStatusChange[]`, `SequenceEnrollment[]`
- `Organization` → `LeadStatusChange[]`, `SequenceEnrollment[]`
- `Sequence` → `SequenceEnrollment[]`

---

## Feature 1: Lead State + Pipeline Automation

### Core Concept

All lead status changes flow through a single function `transitionLeadStatus()`. This function enforces ordering rules, terminal state restrictions, and creates audit records.

### Status Rules

**Pipeline order (STATUS_ORDER):**
```
NEW (0) → CONTACTED (1) → REPLIED (2) → INTERESTED (3) → CONVERTED (4)
```

**Terminal states:** `NOT_INTERESTED`, `UNSUBSCRIBED`, `BOUNCED`

**Transition rules:**
- Automatic transitions never downgrade (e.g., INTERESTED cannot be auto-moved to REPLIED)
- Manual transitions can move in any direction within the active pipeline
- Manual transitions can move to/from terminal states
- Terminal states block: sending messages, enrolling in sequences (enforced at server layer)

### transitionLeadStatus()

**File:** `src/features/leads/server/transition-lead-status.ts`

**Signature:**
```typescript
interface TransitionInput {
  organizationId: string
  leadId: string
  newStatus: LeadStatus
  trigger: string           // "auto:reply_classification", "auto:message_sent", "manual:user"
  actorClerkId?: string     // required for manual, null for auto
  metadata?: Record<string, unknown>
}

interface TransitionResult {
  changed: boolean
  lead: LeadDTO
  previousStatus: LeadStatus
}
```

**Logic:**
1. Fetch lead (org-scoped, throw if not found)
2. If `fromStatus === newStatus`, return `{ changed: false }`
3. If trigger starts with `"auto:"`:
   - Check STATUS_ORDER: if current status rank >= new status rank, skip (no downgrade)
   - Exception: terminal state transitions always apply (auto UNSUBSCRIBED overrides everything)
4. Update Lead.status in transaction with LeadStatusChange creation
5. If new status is terminal: stop all active SequenceEnrollments for this lead (set status=STOPPED, stoppedReason mapped from status)
6. Return result

### Automatic Transition Integration

**In `ingest-reply.ts`** — after classification, call:
```
transitionLeadStatus({
  organizationId, leadId,
  newStatus: CLASSIFICATION_TO_STATUS[classification],
  trigger: "auto:reply_classification",
  metadata: { replyId, classification, confidence }
})
```

Classification mapping:
| Classification | Target Status |
|---|---|
| POSITIVE | INTERESTED |
| NEGATIVE | NOT_INTERESTED |
| OUT_OF_OFFICE | REPLIED |
| UNSUBSCRIBE_REQUEST | UNSUBSCRIBED |
| REFERRAL | REPLIED |
| NEUTRAL | REPLIED |
| UNKNOWN | REPLIED |

**In `send-draft.ts`** — after successful send, call:
```
transitionLeadStatus({
  organizationId, leadId,
  newStatus: "CONTACTED",
  trigger: "auto:message_sent",
  metadata: { messageId, draftId }
})
```

### Terminal State Enforcement

**In `send-draft.ts`:** Before sending, check if lead is in terminal state. If so, throw `LeadInTerminalStateError`.

**In `enroll-lead.ts` (Feature 2):** Before enrolling, check if lead is in terminal state. If so, throw `LeadInTerminalStateError`.

### Manual Status Update

**Server function:** `src/features/leads/server/update-lead-status.ts`
- Calls `transitionLeadStatus()` with trigger `"manual:user"`
- Validates `actorClerkId` is provided

**Route:** `PATCH /api/leads/[id]/status`
- Auth: requires `orgId` from Clerk
- Body: `{ status: LeadStatus }`
- Resolves org, validates lead belongs to org
- Calls `updateLeadStatus()`
- Returns updated LeadDTO

### Pipeline Board

**Server function:** `src/features/leads/server/get-pipeline-leads.ts`
- Input: `{ organizationId }`
- Returns leads grouped by status with computed `lastActivityAt`
- `lastActivityAt` = MAX(latest OutboundMessage.sentAt, latest InboundReply.receivedAt, lead.updatedAt)
- Query: fetch all leads for org with latest message/reply timestamps via subqueries or raw SQL
- Returns `PipelineLeadDTO[]` with fields: id, name, email, company, status, score, lastActivityAt

**DTO:**
```typescript
interface PipelineLeadDTO {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  company: string | null
  status: LeadStatus
  score: number | null
  lastActivityAt: Date
}
```

**Page:** `/app/(dashboard)/pipeline/page.tsx`
- Server component fetches leads via `getPipelineLeads()`
- Passes to `PipelineClient`

**Client:** `pipeline-client.tsx`
- Uses @dnd-kit for drag-and-drop
- Columns for active pipeline: NEW, CONTACTED, REPLIED, INTERESTED, CONVERTED
- Collapsible "Exited" section for: NOT_INTERESTED, UNSUBSCRIBED, BOUNCED
- Lead cards show: name (or email), company, score badge, relative lastActivityAt
- Drag-and-drop: optimistic update → PATCH /api/leads/[id]/status → revert on error
- Error handling: toast notification on failure, revert card position

**Components:**
- `pipeline-board.tsx` — DndContext, columns, sensors
- `pipeline-card.tsx` — draggable lead card

**Sidebar:** Add Pipeline nav item between Leads and Drafts (icon: `Kanban` from lucide-react or `LayoutPanelLeft`).

### Acceptance Criteria

- [ ] Adding INTERESTED and NOT_INTERESTED to LeadStatus enum works with existing data
- [ ] All status changes go through transitionLeadStatus()
- [ ] Auto-transitions from reply classification fire correctly
- [ ] Auto-transition on message send (NEW → CONTACTED) works
- [ ] No automatic downgrades (INTERESTED stays INTERESTED if a NEUTRAL reply comes in)
- [ ] Terminal states stop active sequence enrollments
- [ ] Terminal states block sending and sequence enrollment
- [ ] Manual status changes work via PATCH endpoint
- [ ] Pipeline board shows leads in correct columns
- [ ] Drag-and-drop updates status with optimistic UI
- [ ] Drag-and-drop reverts on server error
- [ ] LeadStatusChange records created for every transition
- [ ] Pipeline queries are org-scoped and performant

---

## Feature 2: Sequence Automation

### Core Concept

Sequences are multi-step email campaigns. A lead is enrolled in a sequence, and the system auto-generates drafts at scheduled intervals. Drafts go through the existing approval workflow before sending. A Vercel cron job polls for due enrollments every 10 minutes.

### SequenceEnrollment Model

See schema section above. Key fields:
- `currentStepNumber`: last completed step (0 = not started)
- `status`: ACTIVE, PAUSED, COMPLETED, STOPPED
- `nextDueAt`: when the next step should execute
- `processing` + `processingStartedAt`: concurrency lock
- `startedAt`: when enrollment began (used for stop condition checks)
- `stoppedReason`: why enrollment stopped

### Enrollment Flow

**Server function:** `src/features/sequences/server/enroll-lead.ts`

**Input:** `{ organizationId, sequenceId, leadId, actorClerkId }`

**Logic:**
1. Validate lead exists and belongs to org
2. Check lead is NOT in terminal state (throw LeadInTerminalStateError)
3. Check no existing enrollment for this (sequenceId, leadId) — unique constraint handles this, but check first for better error message
4. Fetch sequence with steps (throw if no steps)
5. Fetch step 1 to get delayDays
6. Create SequenceEnrollment:
   - `currentStepNumber: 0`
   - `status: ACTIVE`
   - `startedAt: now()`
   - `nextDueAt: now() + step1.delayDays days` (if delayDays=0, due immediately on next cron)
7. Log to AuditLog
8. Return enrollment

### Stop Condition Check

**Server function:** `src/features/sequences/server/check-enrollment-stop.ts`

**Input:** `{ enrollment: SequenceEnrollment, lead: Lead }`

**Returns:** `{ shouldStop: boolean, reason?: string }`

**Logic:**
1. If lead status is terminal → stop with reason mapped from status
2. If lead has any InboundReply where `reply.createdAt > enrollment.startedAt` → stop with reason `"reply_received"`
3. Otherwise → do not stop

### Sequence Runner (Cron)

**Route:** `POST /api/cron/sequence-runner`

**Auth:** Verify `Authorization: Bearer ${CRON_SECRET}` header.

**Logic:**
1. Query enrollments: `WHERE status = ACTIVE AND nextDueAt <= now() AND processing = false ORDER BY nextDueAt ASC LIMIT 50`
2. For each enrollment, atomically claim it:
   ```
   UPDATE SequenceEnrollment
   SET processing = true, processingStartedAt = now()
   WHERE id = ? AND processing = false
   ```
   (If 0 rows updated, skip — another instance claimed it)
3. Call `runSequenceStep(enrollment)`
4. Always set `processing = false` in finally block

**Stale lock recovery:** At start of cron, reset any enrollments where `processing = true AND processingStartedAt < now() - 10 minutes`.

**Server function:** `src/features/sequences/server/run-sequence-step.ts`

**Input:** `{ enrollmentId: string }`

**Logic:**
1. Fetch enrollment with sequence, lead, and steps
2. Call `checkEnrollmentStop()` — if should stop, stop and return STOPPED
3. Determine next step: `currentStepNumber + 1`
4. If no step at that number → mark COMPLETED, return COMPLETED
5. Idempotency check: does a Draft already exist for this (sequenceId, leadId, sequenceStepId)? If yes, return SKIPPED
6. Generate draft:
   - Use step's subject/body as template (or as AI prompt input, matching existing generate-draft pattern)
   - Link draft to campaignId (via sequence.campaignId), sequenceId, sequenceStepId
   - Draft status: PENDING_REVIEW
7. Advance enrollment:
   - `currentStepNumber = nextStepNumber`
   - Calculate next step's `nextDueAt` (if more steps exist): `now() + nextNextStep.delayDays days`
   - If no more steps after this: `nextDueAt = null` (will be marked COMPLETED after this draft is approved and sent)
8. Return DRAFT_GENERATED

### Integration with Feature 1

When `transitionLeadStatus()` moves a lead to a terminal state:
- Query all ACTIVE enrollments for that lead
- Set each to `status: STOPPED`, `stoppedAt: now()`, `stoppedReason` mapped from the terminal status

### Sequence CRUD

**create-sequence.ts:**
- Input: `{ organizationId, campaignId, name, steps: { stepNumber, subject, body, delayDays }[] }`
- Creates Sequence + SequenceSteps in transaction
- Validates campaignId belongs to org
- Returns SequenceDetailDTO

**get-sequences.ts:**
- Input: `{ organizationId, campaignId? }`
- Returns sequences with step count and enrollment counts (active/completed/stopped)

**get-sequence.ts:**
- Input: `{ organizationId, sequenceId }`
- Returns full sequence with steps and enrollment list

**update-sequence.ts:**
- Input: `{ organizationId, sequenceId, name?, steps? }`
- If active enrollments exist: only allow name change and adding new steps at the end
- Cannot remove or reorder steps with active enrollments
- Returns updated SequenceDetailDTO

**get-enrollments.ts:**
- Input: `{ organizationId, sequenceId, status? }`
- Returns enrollments with lead info, current step, next due date

### DTOs

```typescript
interface SequenceDTO {
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

interface SequenceDetailDTO extends SequenceDTO {
  steps: SequenceStepDTO[]
  campaignName: string
}

interface SequenceStepDTO {
  id: string
  stepNumber: number
  subject: string
  body: string
  delayDays: number
}

interface EnrollmentDTO {
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
```

### Routes

- `POST /api/sequences` — create sequence with steps
- `GET /api/sequences/[id]` — get sequence detail
- `PATCH /api/sequences/[id]` — update sequence
- `POST /api/sequences/[id]/enroll` — enroll lead(s), body: `{ leadIds: string[] }`
- `PATCH /api/sequences/enrollments/[id]` — pause/resume/stop, body: `{ action: "pause" | "resume" | "stop" }`
- `POST /api/cron/sequence-runner` — cron endpoint

### Sequence UI

**List page** (`/sequences`):
- Shows sequences grouped by campaign
- Each card: name, step count, enrollment stats, campaign name
- "Create Sequence" button opens modal

**Detail page** (`/sequences/[id]`):
- Steps timeline (visual step indicator with delay days between)
- Enrolled leads table: name, email, current step, status, next due, actions (pause/stop)
- "Enroll Leads" button opens modal with lead picker

**Create sequence modal:**
- Campaign selector (dropdown)
- Sequence name
- Dynamic step form: add/remove steps, each with stepNumber (auto), subject, body, delayDays
- Submit creates via POST /api/sequences

**Enroll modal:**
- Lead search/filter
- Multi-select
- Shows which leads are already enrolled or in terminal state (disabled)
- Submit enrolls via POST /api/sequences/[id]/enroll

### Vercel Cron Config

Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/sequence-runner",
    "schedule": "*/10 * * * *"
  }]
}
```

### Acceptance Criteria

- [ ] Sequences can be created with multiple steps and delay days
- [ ] Leads can be enrolled in a sequence
- [ ] Terminal state leads cannot be enrolled
- [ ] Duplicate enrollment prevented (unique constraint)
- [ ] Cron runner picks up due enrollments ordered by nextDueAt ASC
- [ ] Processing lock prevents concurrent execution of same enrollment
- [ ] Stale locks (>10 min) are recovered
- [ ] Runner checks stop conditions before executing
- [ ] Reply after enrollment started triggers stop
- [ ] Terminal state transition stops all active enrollments
- [ ] Draft generated with correct campaign/sequence/step links
- [ ] Idempotency: no duplicate drafts for same enrollment+step
- [ ] Enrollment advances currentStepNumber after draft generation
- [ ] Enrollment marked COMPLETED when all steps done
- [ ] Pause/resume/stop controls work
- [ ] Sequence edits restricted when active enrollments exist
- [ ] UI shows sequence list, detail, enrollment table
- [ ] Create and enroll modals work correctly

---

## Feature 3: Inbox View

### Core Concept

A threaded conversation view showing all outbound messages and inbound replies for each lead. Threads are derived from existing data (no Thread model). Split-pane layout on desktop, stacked on mobile.

### Thread Assembly (Two-Query Strategy)

**Server function:** `src/features/inbox/server/get-inbox-threads.ts`

**Input:**
```typescript
interface GetInboxThreadsInput {
  organizationId: string
  filter?: 'all' | 'unread' | 'interested' | 'unsubscribed' | 'recent'
  limit?: number   // default 25, max 100
  offset?: number  // default 0
}
```

**Strategy:**

Query 1 — Get leads with latest outbound activity:
```sql
SELECT leadId, MAX(sentAt) as latestOutbound, COUNT(*) as messageCount
FROM OutboundMessage
WHERE organizationId = ?
GROUP BY leadId
```

Query 2 — Get leads with latest inbound activity:
```sql
SELECT leadId, MAX(receivedAt) as latestInbound, COUNT(*) as replyCount,
       SUM(CASE WHEN isRead = false THEN 1 ELSE 0 END) as unreadCount
FROM InboundReply
WHERE organizationId = ?
GROUP BY leadId
```

Merge in server layer:
- Union all leadIds from both queries
- `lastActivityAt = MAX(latestOutbound, latestInbound)` per lead
- Join with Lead table for name/email/company/status
- Apply filter
- Sort by lastActivityAt DESC
- Apply pagination (limit/offset)

For `latestPreview`: fetch the most recent message or reply body (truncated to 120 chars) for each thread in the page. This can be a third lightweight query on the paginated leadIds.

For `latestClassification`: fetch from the most recent InboundReply per lead.

**Returns:** `{ threads: InboxThreadDTO[], total: number }`

### Thread Detail

**Server function:** `src/features/inbox/server/get-thread-detail.ts`

**Input:** `{ organizationId, leadId }`

**Logic:**
1. Fetch lead (org-scoped, throw if not found)
2. Fetch all OutboundMessages for this lead (org-scoped), select id, subject, body, sentAt, status
3. Fetch all InboundReplies for this lead (org-scoped), select id, rawBody, receivedAt, classification, classificationConfidence, isRead
4. Merge into `ThreadMessageDTO[]`, sorted by timestamp ASC
5. Do NOT mark as read here — client calls mark-read explicitly

**Returns:** `ThreadDetailDTO`

### Mark Read

**Server function:** `src/features/inbox/server/mark-thread-read.ts`

**Input:** `{ organizationId, leadId, isRead: boolean }`

**Logic:** `prisma.inboundReply.updateMany({ where: { organizationId, leadId }, data: { isRead } })`

**Route:** `PATCH /api/inbox/[leadId]/read`
- Body: `{ isRead: boolean }`
- Returns: `{ updated: number }`

### DTOs

```typescript
interface InboxThreadDTO {
  leadId: string
  leadName: string           // firstName + lastName or email
  leadEmail: string
  leadCompany: string | null
  leadStatus: LeadStatus
  lastActivityAt: Date
  unreadCount: number
  messageCount: number
  replyCount: number
  latestClassification: ReplyClassification | null
  latestPreview: string      // truncated 120 chars
}

interface ThreadDetailDTO {
  lead: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    company: string | null
    title: string | null
    status: LeadStatus
    score: number | null
  }
  messages: ThreadMessageDTO[]
  totalMessages: number
}

interface ThreadMessageDTO {
  id: string
  direction: 'outbound' | 'inbound'
  subject: string | null
  body: string
  timestamp: Date
  classification?: ReplyClassification
  classificationConfidence?: number
  status?: MessageStatus
  isRead?: boolean           // inbound only
}
```

### Inbox UI

**Page:** `/app/(dashboard)/inbox/page.tsx`
- Server component fetches initial threads (limit 25)
- Passes to InboxClient

**Client:** `inbox-client.tsx`
- State: selectedLeadId, filter, threads
- Split pane layout:
  - Left (~40%): thread list with filter tabs
  - Right (~60%): thread detail or empty state
- When thread selected: fetch detail via client-side fetch, then call mark-read
- Mobile (<1024px): full-width list, selecting opens detail with back button

**Components:**

`thread-list.tsx`:
- Filter tabs: All, Unread, Interested, Recent
- Thread items: lead name, company, preview, timestamp, unread dot, classification badge
- Click selects thread
- Selected thread highlighted

`thread-detail.tsx`:
- Lead header: name, email, company, status badge, score
- Message list (chronological ASC):
  - Outbound bubbles: right-aligned, accent-indigo tinted bg
  - Inbound bubbles: left-aligned, surface bg, classification badge
  - Timestamp dividers between messages
- Empty state: "Select a conversation to view messages"

`message-bubble.tsx`:
- Props: direction, subject, body, timestamp, classification?, status?
- Outbound: shows subject line, body, sent status, right-aligned
- Inbound: shows body, classification badge + confidence, left-aligned

**Empty states:**
- No threads: "No conversations yet. Send your first outreach to get started."
- No messages in thread: "No messages in this conversation."
- No unread: "All caught up! No unread messages."

### Acceptance Criteria

- [ ] Thread list shows all leads with message/reply activity
- [ ] Threads sorted by lastActivityAt DESC
- [ ] lastActivityAt = MAX(latest outbound sentAt, latest inbound receivedAt)
- [ ] Pagination works (default 25, max 100)
- [ ] Filters work: all, unread, interested, recent
- [ ] Thread detail shows outbound + inbound messages chronologically
- [ ] Outbound and inbound messages visually distinct
- [ ] Classification badges on inbound messages
- [ ] Selecting a thread triggers explicit mark-read call
- [ ] Unread indicator on thread list items
- [ ] Split pane on desktop, stacked on mobile
- [ ] Empty states for no threads, no messages, no unread
- [ ] All queries org-scoped
- [ ] Two-query strategy for thread list (no complex single aggregation)

---

## Cross-Feature Concerns

### Common Failure Points

1. **Race conditions in sequence runner:** Mitigated by processing lock + atomic claim. Stale lock recovery handles crashes.
2. **Status transition conflicts:** transitionLeadStatus() is the single source of truth. Auto-transitions don't downgrade.
3. **Duplicate drafts from cron retries:** Idempotency check on (sequenceId, leadId, sequenceStepId) before generation.
4. **Drag-and-drop on slow connections:** Optimistic UI with revert on error. Toast notification explains failure.
5. **Thread list performance at scale:** Two-query strategy avoids complex joins. Pagination enforced. Indexes on organizationId + timestamps.
6. **Webhook timing:** Reply might arrive before message status updates. transitionLeadStatus() handles this by checking current status rank.

### Test Coverage

**Feature 1:**
- transitionLeadStatus: all transition paths, downgrade prevention, terminal state handling
- Pipeline grouping and lastActivityAt computation
- PATCH /api/leads/[id]/status: auth, validation, org scoping
- Integration: ingest-reply triggers correct status transition
- Integration: send-draft triggers NEW → CONTACTED

**Feature 2:**
- enroll-lead: terminal state rejection, duplicate prevention, nextDueAt calculation
- check-enrollment-stop: reply detection, terminal state detection
- run-sequence-step: draft generation, idempotency, step advancement, completion
- Cron route: batch processing, lock claim, stale recovery
- Integration: terminal status change stops enrollments

**Feature 3:**
- get-inbox-threads: two-query merge, filtering, pagination, lastActivityAt
- get-thread-detail: message merging, chronological sort
- mark-thread-read: bulk update, org scoping

### New Dependencies

- `@dnd-kit/core` — drag-and-drop for pipeline board
- `@dnd-kit/sortable` — sortable items within columns
- `@dnd-kit/utilities` — CSS utilities for drag transforms

### Files Summary

**Feature 1 (14 files):**
- Create: 8 files (server functions, route, page, client, components)
- Modify: 5 files (schema, ingest-reply, send-draft, sidebar, leads/types)

**Feature 2 (22 files):**
- Create: 19 files (server functions, routes, page, components, types, cron)
- Modify: 3 files (schema, transition-lead-status, vercel.json)

**Feature 3 (10 files):**
- Create: 9 files (server functions, route, page, client, components, types)
- Modify: 1 file (schema — already done in shared migration)
