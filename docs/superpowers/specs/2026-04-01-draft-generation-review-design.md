# Draft Generation & Review — Design Spec

**Date:** 2026-04-01
**Feature:** Phase 10 — AI draft generation with human approval gate

---

## Goal

Allow users to generate a personalized outbound email draft for any lead in one click. The draft is created with status `PENDING_REVIEW` and must be approved before it can be sent. Approval can include edits to subject and body. The approval gate is enforced at the data layer — nothing reaches `OutboundMessage` without `DraftStatus.APPROVED`.

---

## Scope

This phase ships:
1. Row-level "Generate Draft" action on `/leads`
2. Right-side review drawer on `/leads` (inline review)
3. Dedicated `/drafts` page (centralized review queue)

Not in scope: bulk draft generation, email sending, sequence integration.

---

## Architecture

Feature-oriented monolith. All business logic in `src/features/drafts/server/`. Route handlers are thin (parse → call → respond). AI calls route through `src/lib/ai/` abstraction — feature code never imports OpenAI directly.

---

## AI Provider Extension

Add `draftEmail` to the `AIProvider` interface:

```ts
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

// Added to AIProvider interface:
draftEmail(lead: EmailDraftInput, promptTemplate: string): Promise<EmailDraftOutput>
```

`OpenAIProvider.draftEmail` requests JSON `{ subject, body }` from the model. On parse failure, returns `{ subject: 'Draft for <email>', body: '' }` so the Draft record is always created — the reviewer can edit the body manually. Temperature: 0.4 (more creative than scoring).

---

## Data Flow

### Generate Draft

1. "Generate Draft" row button → `POST /api/drafts/generate` with `{ leadId }`
2. Route: `auth()` → `generateDraft({ organizationId, leadId, clerkUserId })`
3. Server function:
   - Fetch lead (org-scoped; 404 if missing)
   - Fetch active `EMAIL_DRAFT` PromptTemplate — if none, use built-in fallback; `promptTemplateId` is `null` when fallback is used (explicit, for traceability)
   - Call `getAIProvider().draftEmail(lead, prompt)` — **outside** the transaction
   - Open `prisma.$transaction`: re-check for `PENDING_REVIEW` draft on this `leadId` → if found, throw `PendingDraftExistsError({ draftId })` → else create Draft + AuditLog
4. On `PendingDraftExistsError`: route returns 409
5. On success: route returns 200 `DraftDTO`

### Review Draft

1. Approve/reject in drawer → `PATCH /api/drafts/[id]/review`
2. Body: `{ action: 'approve' | 'reject', subject?: string, body?: string, rejectionReason?: string }`
3. Server function:
   - Fetch draft, verify org-scope (403 if wrong org)
   - Verify `status === PENDING_REVIEW` — if not, throw `DraftNotPendingError({ currentStatus })` → route returns 409
   - Approve: optionally apply subject/body edits, set `status = APPROVED`, `approvedByClerkId`, `approvedAt`
   - Reject: set `status = REJECTED`, `rejectedAt`, `rejectionReason`
   - Write AuditLog
   - Return updated `DraftDTO`

### Get Drafts

- Called directly from `/drafts` server component (no GET API route needed)
- `getDrafts({ organizationId, status?, limit?, offset? })`
- Status defaults to `PENDING_REVIEW`, limit capped at 200
- Returns `{ drafts: DraftWithLeadDTO[], total: number }`

---

## API Contracts

### POST /api/drafts/generate

- Body: `{ leadId: string }`
- 200: `DraftDTO`
- 403: no active org
- 404: lead not found
- 409: `{ code: "PENDING_DRAFT_EXISTS", draftId: string, message: string }`

### PATCH /api/drafts/[id]/review

- Body: `{ action: 'approve' | 'reject', subject?: string, body?: string, rejectionReason?: string }`
- 200: updated `DraftDTO`
- 403: draft belongs to different org
- 404: draft not found
- 409: `{ code: "DRAFT_NOT_PENDING", currentStatus: string, message: string }`

---

## DTOs

```ts
// src/features/drafts/types.ts

export type DraftDTO = Pick<Draft,
  | 'id' | 'organizationId' | 'leadId'
  | 'subject' | 'body' | 'status'
  | 'promptTemplateId'
  | 'createdByClerkId' | 'approvedByClerkId'
  | 'approvedAt' | 'rejectedAt' | 'rejectionReason'
  | 'createdAt' | 'updatedAt'
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
```

No schema changes required — `Draft` model already has all fields.

---

## Server Function Signatures

```ts
generateDraft(input: {
  organizationId: string
  leadId: string
  clerkUserId: string
}): Promise<DraftDTO>
// throws PendingDraftExistsError | Error

reviewDraft(input: {
  organizationId: string
  draftId: string
  clerkUserId: string
  action: 'approve' | 'reject'
  subject?: string
  body?: string
  rejectionReason?: string
}): Promise<DraftDTO>
// throws DraftNotPendingError | DraftNotFoundError

getDrafts(input: {
  organizationId: string
  status?: 'PENDING_REVIEW' | 'APPROVED' | 'REJECTED'
  limit?: number
  offset?: number
}): Promise<{ drafts: DraftWithLeadDTO[], total: number }>
```

---

## Error Classes

```ts
export class PendingDraftExistsError extends Error {
  constructor(public readonly draftId: string) {
    super('A pending draft already exists for this lead.')
  }
}

export class DraftNotPendingError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`Draft is not pending review (status: ${currentStatus}).`)
  }
}

export class DraftNotFoundError extends Error {
  constructor() { super('Draft not found.') }
}
```

---

## AuditLog Entries

| Event | `action` | `entityType` | `metadata` |
|---|---|---|---|
| Draft generated | `draft.generated` | `Draft` | `{ leadId, promptTemplateId }` |
| Draft approved | `draft.approved` | `Draft` | `{ leadId, edited: boolean }` |
| Draft rejected | `draft.rejected` | `Draft` | `{ leadId, rejectionReason }` |

---

## UI Components

### LeadsTable (modified)

New optional props for draft actions:
```ts
pendingDrafts?: Map<string, string>  // leadId → draftId
onGenerateDraft?: (leadId: string) => Promise<void>
onReviewDraft?: (draftId: string) => void
```
When `onGenerateDraft` is present, an **Actions** column appears. Table structure is ready for a future checkbox column (bulk generation) without restructuring.

### DraftReviewDrawer (new, shared)

```ts
interface DraftReviewDrawerProps {
  draftId: string | null   // null = closed
  onClose: () => void
  onReviewed: (draft: DraftDTO) => void
}
```
Right-side drawer. Shows editable subject input + body textarea pre-filled with AI content. Approve and Reject buttons. Reject opens an optional rejection reason input. Used on both `/leads` and `/drafts` pages.

### DraftsTable (new, /drafts page only)

Columns: Lead name/email, Subject preview, Status badge, Created at, Actions (Review button).

---

## File Map

```
src/lib/ai/
  provider.ts                    MODIFY
  openai.ts                      MODIFY

src/features/drafts/
  types.ts                       CREATE
  server/
    generate-draft.ts            CREATE
    review-draft.ts              CREATE
    get-drafts.ts                CREATE
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
```

---

## Constraints

- No new infrastructure (no queues, no background jobs)
- All queries org-scoped
- Route handlers stay thin
- AI provider abstraction never bypassed
- Draft must be PENDING_REVIEW before it can be reviewed (enforced at server layer)
- Nothing reaches OutboundMessage without APPROVED status (invariant documented, not yet enforced in Phase 10 since sending is out of scope)
