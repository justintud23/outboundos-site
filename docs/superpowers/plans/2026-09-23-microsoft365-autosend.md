# Microsoft 365 Auto-Send & Reply Escalation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Campaigns send their sequences automatically through Microsoft 365
mailboxes. Replies stop the lead's sequence and are emailed to the user, who
answers in Outlook.

**Architecture:**
- **Transport:** a new `GraphEmailProvider` (app-only Microsoft Graph auth)
  sits behind the existing `EmailProvider` interface.
- **Scheduled jobs:** three cron endpoints, called every 5 minutes by
  cron-job.org:
  - the sequence runner creates drafts: template + AI line + guardrails +
    sample gate, then auto-queues them
  - the send queue sends due messages, paced per mailbox inside business hours
  - the inbox monitor runs Graph delta queries over Inbox and Sent Items to
    detect replies, bounces, auto-replies, and "handled"
- **Staleness:** a daily Vercel cron checks the heartbeats and alerts if a job
  has gone quiet.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Prisma 7 +
Postgres, Clerk Organizations, OpenAI via `src/lib/ai`, Microsoft Graph v1.0
REST (plain `fetch`, no SDK), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-23-microsoft365-autosend-design.md`

### Deliberate deviations from the spec (decided while planning)

1. **Pacing happens at send time, not at queue time.**
   - Queued messages get `scheduledFor = now`.
   - The send queue sends at most one message per mailbox per tick, and only
     when `Mailbox.nextSendAt <= now`.
   - After each send, `nextSendAt = now + (window ÷ today's limit) × random(0.7–1.3)`.
   - Business hours are checked when sending.
   - This is simpler, corrects itself after pauses, and meets the same success
     criteria. It adds `Mailbox.nextSendAt`.
2. **Unmatched replies go in a new `UnmatchedReply` table** instead of making
   `InboundReply.leadId` nullable. About 20 read paths dereference
   `reply.lead`, and a nullable FK would ripple through all of them.
3. **Auto-replies are not stored as `InboundReply`.** `checkEnrollmentStop`
   stops a sequence on *any* `InboundReply`, so storing out-of-office replies
   would stop sequences, and the spec wants them to continue. They are recorded
   as an `AuditLog` row instead.
4. **The heartbeat banner is computed on render** from `CronHeartbeat`, with no
   stored flag. cron-job.org calls the endpoints 24/7; they do nothing outside
   the window but still record a heartbeat. So "stale" simply means no run in
   30 minutes.

## Global Constraints

- **Pacing and hours:**
  - Default business hours are 08:00–17:00, Mon–Fri, in the org's timezone
    (default `America/New_York`).
  - Jitter is ±30%.
  - At most 25 sends per send-queue tick.
- **AI personalization:** at most 60 words, inserted at the `{personalization}`
  marker in the step body.
- **Guardrails** block any of the following:
  - an unfilled `{token}`
  - a `$` amount
  - the words "guarantee", "guaranteed", or "free"
  - any org-blocked phrase
  - an AI-written line over 60 words

  Two exemptions apply: org allowlist words don't trip their rule, and a match
  that appears verbatim in the approved step template is exempt (this never
  applies to the AI line).
- **Sample gate:** `sampleSize` defaults to 10. No auto-send happens until
  `Campaign.sampleApprovedAt` is set.
- **Mailbox assignment is sticky.** One mailbox per enrollment, for its whole
  life.
- **Graph requests:**
  - every Graph request sends `Prefer: IdType="ImmutableId"`
  - a first-step draft's ID is persisted before `/send`
  - follow-ups use `createReply` on the prior message
- **Retries:**
  - send failures retry 3 times, then become `FAILED`
  - AI failures retry 3 times, then produce a `BLOCKED` draft
- **Error handling:**
  - A 401/403 from Graph sets `Organization.sendingPaused` and emails the
    escalation address.
  - 429/503 honor `Retry-After`.
- **Delta sync:** the first sync or a 410 reset uses
  `receivedDateTime ge now-24h`.
- **Time budget:** each cron endpoint stops starting new work after ~45s.
- **Cron auth:** every cron endpoint requires
  `Authorization: Bearer ${CRON_SECRET}`.
- **Notifications:** sent from `MS_NOTIFY_MAILBOX` (a shared mailbox) to
  `Organization.escalationEmail`.
- **Tracking:** no open or click tracking.
- **SendGrid fallback:** SendGrid code stays. `getEmailProvider()` falls back
  to it when the org has no `msTenantId` or `MS_GRAPH_CLIENT_ID` is unset.

## Review Focus

1. **A lead replies while their next follow-up is already `QUEUED`.**
   Expected: the follow-up is cancelled, never sent.
   - Task 12: the send queue re-checks before sending.
   - Task 13: the monitor cancels queued messages on reply.
2. **A lead is missing a merge field** (e.g. no first name). Expected: the
   fallback (`{firstName|there}`) is used, or the draft is `BLOCKED`. Never
   "Hi {firstName}".
   - Task 3: renderer and guardrail tests.
   - Task 10: pipeline test.
3. **The process dies after Graph sent the email but before the DB was
   updated.** Expected: the next tick sees `graphMessageId` → Sent Items →
   marks `SENT` without resending.
   - Task 12 test.
4. **The same inbound message is seen twice** (overlapping delta after a 410
   reset, or a retried tick). Expected: one `InboundReply` and one
   notification.
   - Task 13 test.
5. **Timezone edges.** Expected: the window is correct in both EDT and EST;
   Saturday and 17:00 exactly are outside the window.
   - Task 2 tests.

---

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `src/features/messages/send-window.ts` | Pure business-hours and pacing math |
| `src/features/sequences/render-template.ts` | Pure merge-field rendering with `{field\|fallback}` |
| `src/features/drafts/guardrails.ts` | Pure content guardrails |
| `src/features/inbox/classify-inbound.ts` | Pure INTERNAL / BOUNCE / AUTO_REPLY / HUMAN classifier and bounce recipient extraction |
| `src/lib/email/graph/client.ts` | Token cache, `graphFetch`, and the `GraphError` / `GraphAuthError` / `GraphThrottledError` classes |
| `src/lib/email/graph/mail.ts` | Graph mail operations: drafts, reply drafts, send, message state, delta, `sendMail`, list users |
| `src/lib/email/graph/provider.ts` | `GraphEmailProvider` |
| `src/features/mailboxes/server/mailbox-slots.ts` | Atomic daily-slot reserve/release, extracted from `send-draft.ts` |
| `src/features/sequences/server/assign-mailbox.ts` | Sticky least-loaded mailbox assignment |
| `src/features/messages/server/queue-draft.ts` | Create a `QUEUED` `OutboundMessage` for an approved draft |
| `src/features/messages/server/process-send-queue.ts` | Send-queue tick |
| `src/features/replies/server/record-reply.ts` | Classify, persist, and transition a reply (extracted from `ingest-reply.ts`) |
| `src/features/replies/server/notify.ts` | Reply, unmatched-reply, and org-alert notification emails |
| `src/features/inbox/server/monitor-mailboxes.ts` | Inbox-monitor tick |
| `src/features/campaigns/server/campaign-sending.ts` | Create campaign, update auto-send settings, approve sample |
| `src/features/settings/server/sending-settings.ts` | Read and update org sending settings |
| `src/features/integrations/server/microsoft.ts` | Admin-consent URL, tenant save, mailbox import |
| `src/lib/cron.ts` | `isAuthorizedCron`, `recordHeartbeat`, `getStaleJobs` |

**New routes**

- `src/app/api/cron/send-queue/route.ts`
- `src/app/api/cron/inbox-monitor/route.ts`
- `src/app/api/cron/heartbeat-check/route.ts`
- `src/app/api/campaigns/route.ts`
- `src/app/api/campaigns/[id]/route.ts`
- `src/app/api/campaigns/[id]/approve-sample/route.ts`
- `src/app/api/settings/sending/route.ts`
- `src/app/api/integrations/microsoft/connect/route.ts`
- `src/app/api/integrations/microsoft/callback/route.ts`
- `src/app/api/integrations/microsoft/users/route.ts`
- `src/app/api/integrations/microsoft/mailboxes/route.ts`

**New UI**

- `src/features/settings/components/microsoft-card.tsx`
- `src/features/settings/components/sending-settings-form.tsx`
- `src/features/campaigns/components/campaign-sending-panel.tsx`
- `src/features/campaigns/components/new-campaign-form.tsx`
- `src/components/layout/system-banner.tsx`

**Modified**

| File | Change |
|---|---|
| `prisma/schema.prisma` | New fields and models |
| `src/lib/email/provider.ts` | Interface extension |
| `src/lib/email/index.ts` | Provider selection |
| `src/lib/ai/provider.ts`, `src/lib/ai/openai.ts` | `personalize` |
| `src/features/messages/server/send-draft.ts` | Slots extracted; Graph threading and IDs |
| `src/features/sequences/server/run-sequence-step.ts` | Pipeline |
| `src/features/sequences/types.ts` | `StepResult`, step DTO |
| `src/features/sequences/server/create-sequence.ts`, `src/app/api/sequences/route.ts`, `src/features/sequences/components/create-sequence-form.tsx` | `personalizationPrompt` |
| `src/features/drafts/server/review-draft.ts` | `BLOCKED` handling and auto-queue |
| `src/features/replies/server/ingest-reply.ts` | Uses `recordReply` |
| `src/app/api/cron/sequence-runner/route.ts` | Uses `src/lib/cron.ts` and records a heartbeat |
| `src/features/actions/types.ts`, `src/features/actions/server/get-next-actions.ts` | `BLOCKED` / `FAILED` actions |
| `src/app/(dashboard)/campaigns/[id]/page.tsx` | `BLOCKED` labels, sending panel |
| `src/app/(dashboard)/campaigns/page.tsx` | New-campaign form |
| `src/app/(dashboard)/settings/page.tsx`, `src/app/(dashboard)/settings/settings-client.tsx` | Microsoft card, sending settings |
| `src/app/(dashboard)/layout.tsx` | System banner |
| `vercel.json`, `.env.example`, `README.md` | Config and docs |

---

### Task 1: Schema migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_microsoft365_autosend/migration.sql` (generated)
- Modify: `src/app/(dashboard)/campaigns/[id]/page.tsx:21-31` (exhaustive `DraftStatus` maps)

**Interfaces:**
- Produces every field and model later tasks use: `MailboxProvider`,
  `Mailbox.nextSendAt`, `UnmatchedReply`, `CronHeartbeat`, and the rest,
  exactly as named below.

- [ ] **Step 1: Start local Postgres and confirm the baseline is green**

Run: `docker compose up -d && npx prisma migrate deploy && npm test`
Expected: migrations apply; `Test Files 57 passed`.

- [ ] **Step 2: Edit `prisma/schema.prisma`**

Add the enum values:

```prisma
enum DraftStatus {
  PENDING_REVIEW
  APPROVED
  REJECTED
  BLOCKED
}

enum MessageStatus {
  QUEUED
  SENT
  DELIVERED
  OPENED
  CLICKED
  REPLIED
  BOUNCED
  FAILED
  CANCELLED
}

enum MailboxProvider {
  SENDGRID
  MICROSOFT_GRAPH
}
```

In `model Organization`, add after `updatedAt`:

```prisma
  // Sending schedule (org timezone). sendDays uses 0=Sun … 6=Sat.
  timezone           String   @default("America/New_York")
  businessHoursStart Int      @default(8)
  businessHoursEnd   Int      @default(17)
  sendDays           Int[]    @default([1, 2, 3, 4, 5])
  escalationEmail    String?
  // Org-wide kill switch. Set by a human, or automatically on Graph 401/403.
  sendingPaused      Boolean  @default(false)
  pausedReason       String?
  guardrailBlockedPhrases String[] @default([])
  guardrailAllowedWords   String[] @default([])
  // Microsoft 365 sending tenant (app-only Graph auth; secret lives in env).
  msTenantId         String?
```

Also add `unmatchedReplies UnmatchedReply[]` to its relation list.

In `model Mailbox`, add after `breakerResetAt`:

```prisma
  provider        MailboxProvider @default(SENDGRID)
  graphUserId     String?
  // Resumable Graph delta URLs (a deltaLink, or a nextLink mid-sync).
  inboxDeltaLink  String?
  sentDeltaLink   String?
  lastPolledAt    DateTime?
  // Send-time pacing: earliest moment this mailbox may send again.
  nextSendAt      DateTime?
```

Also add these to its relation list:

```prisma
  enrollments      SequenceEnrollment[]
  inboundReplies   InboundReply[]
  unmatchedReplies UnmatchedReply[]
```

In `model Campaign`, add after `status`:

```prisma
  autoSend         Boolean   @default(false)
  sampleSize       Int       @default(10)
  sampleApprovedAt DateTime?
```

In `model SequenceStep`, add after `delayDays`:

```prisma
  // Guidance for the AI-written line inserted at {personalization}.
  personalizationPrompt String?
```

In `model SequenceEnrollment`, add after `stoppedReason`:

```prisma
  mailboxId      String?
  mailbox        Mailbox? @relation(fields: [mailboxId], references: [id], onDelete: SetNull)
  failedAttempts Int      @default(0)
```

Also add `@@index([mailboxId])`.

In `model Draft`, add after `status`:

```prisma
  guardrailFlags Json?
  isSample       Boolean @default(false)
```

Also add `@@index([campaignId, isSample])`.

In `model OutboundMessage`, add after `sentAt`:

```prisma
  scheduledFor        DateTime?
  graphMessageId      String?   @unique
  conversationId      String?
  processing          Boolean   @default(false)
  processingStartedAt DateTime?
  sendAttempts        Int       @default(0)
  lastError           String?
```

Also add `@@index([status, scheduledFor])` and `@@index([conversationId])`.

In `model InboundReply`, add after `classificationConfidence`:

```prisma
  mailboxId      String?
  mailbox        Mailbox?  @relation(fields: [mailboxId], references: [id], onDelete: SetNull)
  graphMessageId String?   @unique
  conversationId String?
  fromEmail      String?
  subject        String?
  notifiedAt     DateTime?
  handledAt      DateTime?
```

Also add `@@index([conversationId])`.

Add the new models at the end of the file:

```prisma
// A human reply that couldn't be matched to a lead (e.g. a colleague answering
// for them). Kept separate so InboundReply.leadId stays non-null.
model UnmatchedReply {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  mailboxId      String
  mailbox        Mailbox      @relation(fields: [mailboxId], references: [id], onDelete: Cascade)
  graphMessageId String       @unique
  conversationId String?
  fromEmail      String
  subject        String
  bodyPreview    String
  receivedAt     DateTime
  notifiedAt     DateTime?
  handledAt      DateTime?
  createdAt      DateTime     @default(now())

  @@index([organizationId])
  @@index([conversationId])
  @@map("unmatched_replies")
}

model CronHeartbeat {
  job        String   @id
  lastRunAt  DateTime
  lastResult Json?

  @@map("cron_heartbeats")
}
```

- [ ] **Step 3: Generate the migration and client**

Run: `npx prisma migrate dev --name microsoft365_autosend && npx prisma generate`
Expected: a new folder `prisma/migrations/*_microsoft365_autosend/` is
created and the client is generated. Open `migration.sql` and confirm it
contains only `ALTER TABLE … ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`, and
`ALTER TYPE … ADD VALUE`. There should be no `DROP`.

- [ ] **Step 4: Fix the exhaustive `DraftStatus` maps**

In `src/app/(dashboard)/campaigns/[id]/page.tsx`, replace both maps:

```tsx
const DRAFT_STATUS_VARIANT: Record<DraftStatus, 'warning' | 'success' | 'danger'> = {
  PENDING_REVIEW: 'warning',
  APPROVED:       'success',
  REJECTED:       'danger',
  BLOCKED:        'danger',
}

const DRAFT_STATUS_LABEL: Record<DraftStatus, string> = {
  PENDING_REVIEW: 'Pending Review',
  APPROVED:       'Approved',
  REJECTED:       'Rejected',
  BLOCKED:        'Blocked',
}
```

- [ ] **Step 5: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; all tests pass. If `tsc` reports another exhaustive
`Record<DraftStatus|MessageStatus, …>`, add the new key the same way.

- [ ] **Step 6: Commit**

```bash
git add prisma src/app/\(dashboard\)/campaigns/\[id\]/page.tsx
git commit -m "feat(db): schema for Microsoft 365 auto-send and reply escalation"
```

---

### Task 2: Send window and pacing (pure)

**Files:**
- Create: `src/features/messages/send-window.ts`
- Test: `src/features/messages/send-window.test.ts`

**Interfaces:**
- Produces:
  - `interface SendWindowConfig { timezone: string; businessHoursStart: number; businessHoursEnd: number; sendDays: number[] }`
  - `isValidTimezone(tz: string): boolean`
  - `zonedParts(date: Date, timezone: string): { weekday: number; hour: number; minute: number }`
  - `isInSendWindow(now: Date, cfg: SendWindowConfig): boolean`
  - `mailboxSpacingMs(cfg: SendWindowConfig, dailyLimit: number): number`
  - `nextSendAt(now: Date, spacingMs: number, random?: () => number): Date`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import {
  isInSendWindow,
  isValidTimezone,
  mailboxSpacingMs,
  nextSendAt,
  zonedParts,
  type SendWindowConfig,
} from './send-window'

const CFG: SendWindowConfig = {
  timezone: 'America/New_York',
  businessHoursStart: 8,
  businessHoursEnd: 17,
  sendDays: [1, 2, 3, 4, 5],
}

describe('zonedParts', () => {
  it('converts UTC to the org timezone (EDT, UTC-4)', () => {
    // Wed 2026-09-23 13:05 UTC = 09:05 EDT
    expect(zonedParts(new Date('2026-09-23T13:05:00Z'), 'America/New_York')).toEqual({
      weekday: 3,
      hour: 9,
      minute: 5,
    })
  })
})

describe('isInSendWindow', () => {
  it('is open at 09:00 on a Wednesday (EDT)', () => {
    expect(isInSendWindow(new Date('2026-09-23T13:00:00Z'), CFG)).toBe(true)
  })
  it('is closed at 07:30 local', () => {
    expect(isInSendWindow(new Date('2026-09-23T11:30:00Z'), CFG)).toBe(false)
  })
  it('is closed at exactly 17:00 local (end is exclusive)', () => {
    expect(isInSendWindow(new Date('2026-09-23T21:00:00Z'), CFG)).toBe(false)
  })
  it('is open at 16:59 local', () => {
    expect(isInSendWindow(new Date('2026-09-23T20:59:00Z'), CFG)).toBe(true)
  })
  it('is closed on Saturday', () => {
    expect(isInSendWindow(new Date('2026-09-26T15:00:00Z'), CFG)).toBe(false)
  })
  it('handles EST (UTC-5) after the DST change: 08:30 EST Wed 2026-11-18 is 13:30 UTC', () => {
    expect(isInSendWindow(new Date('2026-11-18T13:30:00Z'), CFG)).toBe(true)
    // 12:30 UTC is 07:30 EST — closed (it would be 08:30 under EDT)
    expect(isInSendWindow(new Date('2026-11-18T12:30:00Z'), CFG)).toBe(false)
  })
})

describe('isValidTimezone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimezone('America/Chicago')).toBe(true)
    expect(isValidTimezone('Not/AZone')).toBe(false)
  })
})

describe('mailboxSpacingMs', () => {
  it('spreads the daily limit across the window: 9h / 30 = 18 min', () => {
    expect(mailboxSpacingMs(CFG, 30)).toBe(18 * 60 * 1000)
  })
  it('never divides by zero', () => {
    expect(mailboxSpacingMs(CFG, 0)).toBe(9 * 60 * 60 * 1000)
  })
})

describe('nextSendAt', () => {
  const now = new Date('2026-09-23T13:00:00Z')
  it('applies -30% jitter at random=0', () => {
    expect(nextSendAt(now, 1_000_000, () => 0).getTime()).toBe(now.getTime() + 700_000)
  })
  it('applies +30% jitter at random→1', () => {
    expect(nextSendAt(now, 1_000_000, () => 1).getTime()).toBe(now.getTime() + 1_300_000)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/messages/send-window.test.ts`
Expected: FAIL, "Failed to resolve import './send-window'".

- [ ] **Step 3: Implement**

```ts
// Business-hours window and per-mailbox pacing. Pure: all time math goes
// through Intl so the org's IANA timezone (incl. DST) is honored without a
// date library.

export interface SendWindowConfig {
  timezone: string
  businessHoursStart: number // hour, 0–23, inclusive
  businessHoursEnd: number // hour, 1–24, exclusive
  sendDays: number[] // 0=Sun … 6=Sat
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function zonedParts(
  date: Date,
  timezone: string,
): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    weekday: WEEKDAYS[get('weekday')] ?? -1,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

export function isInSendWindow(now: Date, cfg: SendWindowConfig): boolean {
  const { weekday, hour, minute } = zonedParts(now, cfg.timezone)
  if (!cfg.sendDays.includes(weekday)) return false
  const minutes = hour * 60 + minute
  return minutes >= cfg.businessHoursStart * 60 && minutes < cfg.businessHoursEnd * 60
}

/** Even spacing that spreads `dailyLimit` sends across the business window. */
export function mailboxSpacingMs(cfg: SendWindowConfig, dailyLimit: number): number {
  const windowMs = (cfg.businessHoursEnd - cfg.businessHoursStart) * 60 * 60 * 1000
  return Math.floor(windowMs / Math.max(1, dailyLimit))
}

/** now + spacing × U(0.7, 1.3): ±30% jitter so sends don't land on a grid. */
export function nextSendAt(now: Date, spacingMs: number, random: () => number = Math.random): Date {
  const factor = 0.7 + 0.6 * random()
  return new Date(now.getTime() + Math.round(spacingMs * factor))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/messages/send-window.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/messages/send-window.ts src/features/messages/send-window.test.ts
git commit -m "feat(messages): business-hours window and per-mailbox pacing"
```

---

### Task 3: Template rendering and guardrails (pure)

**Files:**
- Create: `src/features/sequences/render-template.ts`
- Test: `src/features/sequences/render-template.test.ts`
- Create: `src/features/drafts/guardrails.ts`
- Test: `src/features/drafts/guardrails.test.ts`

**Interfaces:**
- Produces, in `render-template.ts`:
  - `PERSONALIZATION_TOKEN = '{personalization}'`
  - `interface TemplateLead { firstName?: string | null; lastName?: string | null; company?: string | null; title?: string | null; customFields?: unknown }`
  - `renderTemplate(text: string, lead: TemplateLead): string`
  - `insertPersonalization(body: string, line: string | null): string`
- Produces, in `guardrails.ts`:
  - `type GuardrailRule = 'UNFILLED_TOKEN' | 'CURRENCY' | 'RISKY_WORD' | 'BLOCKED_PHRASE' | 'PERSONALIZATION_TOO_LONG' | 'AI_FAILED'`
  - `interface GuardrailFlag { rule: GuardrailRule; match: string }`
  - `MAX_PERSONALIZATION_WORDS = 60`
  - `checkGuardrails(input: GuardrailInput): GuardrailFlag[]`, where
    `GuardrailInput = { subject: string; body: string; personalization: string | null; templateText: string; blockedPhrases: string[]; allowedWords: string[] }`

- [ ] **Step 1: Write the failing renderer tests**

```ts
import { describe, it, expect } from 'vitest'
import { renderTemplate, insertPersonalization } from './render-template'

describe('renderTemplate', () => {
  const lead = { firstName: 'Jane', lastName: 'Doe', company: 'Acme PM', title: null, customFields: { city: 'Buffalo', lots: 4 } }

  it('fills built-in and custom fields', () => {
    expect(renderTemplate('Hi {firstName} at {company} in {city} ({lots} lots)', lead)).toBe(
      'Hi Jane at Acme PM in Buffalo (4 lots)',
    )
  })
  it('uses the fallback when the value is missing or blank', () => {
    expect(renderTemplate('Hi {firstName|there}', { firstName: '  ' })).toBe('Hi there')
    expect(renderTemplate('Re: {title|your properties}', lead)).toBe('Re: your properties')
  })
  it('leaves a token with no value and no fallback untouched (guardrails catch it)', () => {
    expect(renderTemplate('Hi {firstName}', {})).toBe('Hi {firstName}')
  })
  it('never touches {personalization}', () => {
    expect(renderTemplate('{personalization}', lead)).toBe('{personalization}')
  })
  it('ignores non-object customFields', () => {
    expect(renderTemplate('{city|here}', { customFields: 'junk' })).toBe('here')
  })
})

describe('insertPersonalization', () => {
  it('replaces the marker with the line', () => {
    expect(insertPersonalization('Hi.\n\n{personalization}\n\nBye', 'Saw your lot.')).toBe(
      'Hi.\n\nSaw your lot.\n\nBye',
    )
  })
  it('removes the marker cleanly when there is no line', () => {
    expect(insertPersonalization('Hi.\n\n{personalization}\n\nBye', null)).toBe('Hi.\n\nBye')
  })
})
```

- [ ] **Step 2: Write the failing guardrail tests**

```ts
import { describe, it, expect } from 'vitest'
import { checkGuardrails } from './guardrails'

const base = {
  subject: 'Snow plan for Acme',
  body: 'Hi Jane, we plow commercial lots in Buffalo.',
  personalization: null,
  templateText: 'Snow plan for {company}\nHi {firstName|there}, we plow commercial lots in Buffalo.',
  blockedPhrases: [],
  allowedWords: [],
}

describe('checkGuardrails', () => {
  it('passes clean content', () => {
    expect(checkGuardrails(base)).toEqual([])
  })
  it('flags an unfilled token', () => {
    expect(checkGuardrails({ ...base, body: 'Hi {firstName}, …' })).toContainEqual({
      rule: 'UNFILLED_TOKEN',
      match: '{firstName}',
    })
  })
  it('flags a dollar amount the template did not contain', () => {
    expect(checkGuardrails({ ...base, body: 'Plowing from $1,200 a season' })).toContainEqual({
      rule: 'CURRENCY',
      match: '$1,200',
    })
  })
  it('exempts a dollar amount written in the approved template', () => {
    const t = { ...base, templateText: base.templateText + ' Plans from $99.', body: 'Plans from $99.' }
    expect(checkGuardrails(t)).toEqual([])
  })
  it('flags risky words unless allowlisted', () => {
    const body = 'We guarantee a free estimate.'
    expect(checkGuardrails({ ...base, body }).map((f) => f.match.toLowerCase())).toEqual(['guarantee', 'free'])
    expect(checkGuardrails({ ...base, body, allowedWords: ['free'] }).map((f) => f.match)).toEqual(['guarantee'])
  })
  it('still flags risky words inside the AI line even if the template has them', () => {
    const t = {
      ...base,
      templateText: 'Get a free quote. {personalization}',
      body: 'Get a free quote. It is free forever.',
      personalization: 'It is free forever.',
    }
    expect(checkGuardrails(t)).toContainEqual({ rule: 'RISKY_WORD', match: 'free' })
  })
  it('flags org-blocked phrases case-insensitively', () => {
    expect(
      checkGuardrails({ ...base, body: 'We are the CHEAPEST in town', blockedPhrases: ['cheapest'] }),
    ).toContainEqual({ rule: 'BLOCKED_PHRASE', match: 'cheapest' })
  })
  it('flags an AI line over 60 words', () => {
    const long = Array.from({ length: 61 }, () => 'word').join(' ')
    expect(checkGuardrails({ ...base, personalization: long })).toContainEqual({
      rule: 'PERSONALIZATION_TOO_LONG',
      match: '61 words',
    })
  })
  it('does not duplicate identical flags', () => {
    expect(checkGuardrails({ ...base, body: 'free free free' })).toHaveLength(1)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/features/sequences/render-template.test.ts src/features/drafts/guardrails.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement `render-template.ts`**

```ts
// Merge-field rendering for sequence templates.
// Syntax: {field} or {field|fallback}. Built-ins come from the Lead row; any
// other key is looked up in Lead.customFields (CSV extra columns). A field with
// no value and no fallback is left as-is so the guardrails BLOCK the draft
// instead of sending "Hi {firstName}".

export const PERSONALIZATION_TOKEN = '{personalization}'

export interface TemplateLead {
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  title?: string | null
  customFields?: unknown
}

const BUILTIN_FIELDS = new Set(['firstName', 'lastName', 'company', 'title'])
const TOKEN = /\{([a-zA-Z][a-zA-Z0-9_]*)(?:\|([^}]*))?\}/g

function toText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return ''
}

export function renderTemplate(text: string, lead: TemplateLead): string {
  const custom =
    lead.customFields && typeof lead.customFields === 'object' && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {}

  return text.replace(TOKEN, (whole, key: string, fallback: string | undefined) => {
    if (key === 'personalization') return whole
    const raw = BUILTIN_FIELDS.has(key) ? lead[key as keyof TemplateLead] : custom[key]
    const value = toText(raw)
    if (value) return value
    if (fallback !== undefined) return fallback
    return whole
  })
}

export function insertPersonalization(body: string, line: string | null): string {
  return body
    .replace(PERSONALIZATION_TOKEN, line?.trim() ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
```

- [ ] **Step 5: Implement `guardrails.ts`**

```ts
// Content guardrails for auto-sent drafts. A non-empty result means the draft
// is BLOCKED and needs a human. Content rules (currency / risky words / blocked
// phrases) exempt text the human already approved in the step template — but
// never text inside the AI-written line.

export type GuardrailRule =
  | 'UNFILLED_TOKEN'
  | 'CURRENCY'
  | 'RISKY_WORD'
  | 'BLOCKED_PHRASE'
  | 'PERSONALIZATION_TOO_LONG'
  | 'AI_FAILED'

export interface GuardrailFlag {
  rule: GuardrailRule
  match: string
}

export interface GuardrailInput {
  subject: string
  body: string
  personalization: string | null
  templateText: string
  blockedPhrases: string[]
  allowedWords: string[]
}

export const MAX_PERSONALIZATION_WORDS = 60

const UNFILLED = /\{[^{}\s]+\}/g
const CURRENCY = /\$\s?\d[\d,]*(?:\.\d+)?/g
const RISKY = /\b(guarantee|guaranteed|free)\b/gi

export function checkGuardrails(input: GuardrailInput): GuardrailFlag[] {
  const text = `${input.subject}\n${input.body}`
  const template = input.templateText.toLowerCase()
  const aiLine = (input.personalization ?? '').toLowerCase()
  const allowed = new Set(input.allowedWords.map((w) => w.trim().toLowerCase()).filter(Boolean))

  const flags: GuardrailFlag[] = []
  const seen = new Set<string>()
  const add = (rule: GuardrailRule, match: string) => {
    const key = `${rule}:${match.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    flags.push({ rule, match })
  }
  // Exempt only when the human wrote it in the template AND the AI line doesn't contain it.
  const exempt = (m: string) => template.includes(m.toLowerCase()) && !aiLine.includes(m.toLowerCase())

  for (const m of text.match(UNFILLED) ?? []) add('UNFILLED_TOKEN', m)
  for (const m of text.match(CURRENCY) ?? []) if (!exempt(m)) add('CURRENCY', m)
  for (const m of text.match(RISKY) ?? []) {
    if (!allowed.has(m.toLowerCase()) && !exempt(m)) add('RISKY_WORD', m)
  }

  const lowerText = text.toLowerCase()
  for (const raw of input.blockedPhrases) {
    const phrase = raw.trim().toLowerCase()
    if (phrase && lowerText.includes(phrase) && !exempt(phrase)) add('BLOCKED_PHRASE', phrase)
  }

  if (input.personalization) {
    const words = input.personalization.trim().split(/\s+/).filter(Boolean).length
    if (words > MAX_PERSONALIZATION_WORDS) add('PERSONALIZATION_TOO_LONG', `${words} words`)
  }

  return flags
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/features/sequences/render-template.test.ts src/features/drafts/guardrails.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/sequences/render-template* src/features/drafts/guardrails*
git commit -m "feat(drafts): merge-field rendering with fallbacks and content guardrails"
```

---

### Task 4: Inbound message classifier (pure)

**Files:**
- Create: `src/features/inbox/classify-inbound.ts`
- Test: `src/features/inbox/classify-inbound.test.ts`

**Interfaces:**
- Produces:
  - `interface InboundMessage { fromAddress: string; subject: string; bodyText: string; headers: Record<string, string> }` (header names lower-cased)
  - `type InboundKind = 'INTERNAL' | 'BOUNCE' | 'AUTO_REPLY' | 'HUMAN'`
  - `classifyInboundMessage(msg: InboundMessage, ownAddresses: ReadonlySet<string>): InboundKind`
  - `extractBouncedRecipients(bodyText: string, ownAddresses: ReadonlySet<string>): string[]`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { classifyInboundMessage, extractBouncedRecipients, type InboundMessage } from './classify-inbound'

const OWN = new Set(['mike@getacmesnow.com', 'alerts@getacmesnow.com'])
const msg = (o: Partial<InboundMessage>): InboundMessage => ({
  fromAddress: 'jane@acmepm.com',
  subject: 'Re: Snow plan for Acme',
  bodyText: 'Sounds good, can you quote our 3 lots?',
  headers: {},
  ...o,
})

describe('classifyInboundMessage', () => {
  it('HUMAN for a normal reply', () => {
    expect(classifyInboundMessage(msg({}), OWN)).toBe('HUMAN')
  })
  it('INTERNAL for mail from our own mailboxes (case-insensitive)', () => {
    expect(classifyInboundMessage(msg({ fromAddress: 'Mike@GetAcmeSnow.com' }), OWN)).toBe('INTERNAL')
  })
  it('BOUNCE for an Exchange Online NDR', () => {
    const ndr = msg({
      fromAddress: 'MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@getacmesnow.com',
      subject: 'Undeliverable: Snow plan for Acme',
      bodyText: "Your message to bob@nowhere.example couldn't be delivered.",
    })
    expect(classifyInboundMessage(ndr, OWN)).toBe('BOUNCE')
  })
  it('BOUNCE for a postmaster DSN', () => {
    expect(classifyInboundMessage(msg({ fromAddress: 'postmaster@acmepm.com', subject: 'Delivery Status Notification (Failure)' }), OWN)).toBe('BOUNCE')
  })
  it('BOUNCE for a multipart/report delivery-status', () => {
    expect(
      classifyInboundMessage(msg({ headers: { 'content-type': 'multipart/report; report-type=delivery-status' } }), OWN),
    ).toBe('BOUNCE')
  })
  it('AUTO_REPLY for Auto-Submitted: auto-replied', () => {
    expect(classifyInboundMessage(msg({ headers: { 'auto-submitted': 'auto-replied' } }), OWN)).toBe('AUTO_REPLY')
  })
  it('HUMAN when Auto-Submitted: no', () => {
    expect(classifyInboundMessage(msg({ headers: { 'auto-submitted': 'no' } }), OWN)).toBe('HUMAN')
  })
  it('AUTO_REPLY for an Outlook "Automatic reply:" subject with no headers', () => {
    expect(classifyInboundMessage(msg({ subject: 'Automatic reply: Snow plan for Acme' }), OWN)).toBe('AUTO_REPLY')
  })
  it('AUTO_REPLY for Out of Office subject', () => {
    expect(classifyInboundMessage(msg({ subject: 'Out of Office Re: Snow plan' }), OWN)).toBe('AUTO_REPLY')
  })
})

describe('extractBouncedRecipients', () => {
  it('pulls distinct external addresses, lower-cased, excluding ours and postmaster', () => {
    const body = "Your message to Bob@Nowhere.example couldn't be delivered. bob@nowhere.example\nFrom: mike@getacmesnow.com postmaster@nowhere.example"
    expect(extractBouncedRecipients(body, OWN)).toEqual(['bob@nowhere.example'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/inbox/classify-inbound.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// Classifies a message that arrived in a sending mailbox's Inbox. Order
// matters: NDRs often also carry Auto-Submitted, so BOUNCE is checked first.

export interface InboundMessage {
  fromAddress: string
  subject: string
  bodyText: string
  headers: Record<string, string> // names lower-cased
}

export type InboundKind = 'INTERNAL' | 'BOUNCE' | 'AUTO_REPLY' | 'HUMAN'

const BOUNCE_SENDER = /^(postmaster|mailer-daemon|microsoftexchange[0-9a-f]*)@/i
const BOUNCE_SUBJECT =
  /^\s*(undeliverable|undelivered mail returned to sender|delivery status notification \(failure\)|mail delivery failed|returned mail|delivery has failed|failure notice)/i
const AUTO_SUBJECT = /^\s*(automatic reply|auto[- ]?reply|autoreply|out of (the )?office)/i
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

export function classifyInboundMessage(msg: InboundMessage, ownAddresses: ReadonlySet<string>): InboundKind {
  const from = msg.fromAddress.trim().toLowerCase()
  const own = new Set([...ownAddresses].map((a) => a.toLowerCase()))
  if (own.has(from)) return 'INTERNAL'

  const contentType = msg.headers['content-type'] ?? ''
  if (
    BOUNCE_SENDER.test(from) ||
    BOUNCE_SUBJECT.test(msg.subject) ||
    (/multipart\/report/i.test(contentType) && /delivery-status/i.test(contentType))
  ) {
    return 'BOUNCE'
  }

  const autoSubmitted = msg.headers['auto-submitted']
  if (
    (autoSubmitted !== undefined && autoSubmitted.trim().toLowerCase() !== 'no') ||
    'x-autoreply' in msg.headers ||
    'x-autorespond' in msg.headers ||
    /^(auto_reply|bulk|junk)$/i.test((msg.headers['precedence'] ?? '').trim()) ||
    AUTO_SUBJECT.test(msg.subject)
  ) {
    return 'AUTO_REPLY'
  }

  return 'HUMAN'
}

export function extractBouncedRecipients(bodyText: string, ownAddresses: ReadonlySet<string>): string[] {
  const own = new Set([...ownAddresses].map((a) => a.toLowerCase()))
  const found = new Set<string>()
  for (const m of bodyText.match(EMAIL) ?? []) {
    const addr = m.toLowerCase()
    if (own.has(addr) || BOUNCE_SENDER.test(addr)) continue
    found.add(addr)
  }
  return [...found]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/inbox/classify-inbound.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/inbox/classify-inbound*
git commit -m "feat(inbox): classify inbound mail as bounce, auto-reply, internal, or human"
```

---

### Task 5: Graph client (auth, fetch, errors)

**Files:**
- Create: `src/lib/email/graph/client.ts`
- Test: `src/lib/email/graph/client.test.ts`

**Interfaces:**
- Produces:
  - `GRAPH_BASE = 'https://graph.microsoft.com/v1.0'`
  - `class GraphError extends Error { status: number; code?: string }`
  - `class GraphAuthError extends GraphError`
  - `class GraphThrottledError extends GraphError { retryAfterSeconds: number }`
  - `getGraphToken(tenantId: string): Promise<string>`
  - `graphFetch<T>(tenantId: string, pathOrUrl: string, opts?: { method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'; body?: unknown; prefer?: string[] }): Promise<T>`
  - `__resetGraphTokenCache(): void` (tests only)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  graphFetch,
  getGraphToken,
  GraphAuthError,
  GraphThrottledError,
  GraphError,
  __resetGraphTokenCache,
} from './client'

const fetchMock = vi.fn()

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  __resetGraphTokenCache()
  process.env.MS_GRAPH_CLIENT_ID = 'cid'
  process.env.MS_GRAPH_CLIENT_SECRET = 'secret'
})
afterEach(() => vi.unstubAllGlobals())

describe('getGraphToken', () => {
  it('requests a client-credentials token and caches it', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'tok', expires_in: 3600 }))
    expect(await getGraphToken('tenant-1')).toBe('tok')
    expect(await getGraphToken('tenant-1')).toBe('tok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token')
    expect(String((init as RequestInit).body)).toContain('grant_type=client_credentials')
    expect(String((init as RequestInit).body)).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default')
  })
  it('throws GraphAuthError when the token request fails', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_client' }))
    await expect(getGraphToken('tenant-1')).rejects.toBeInstanceOf(GraphAuthError)
  })
})

describe('graphFetch', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'tok', expires_in: 3600 }))
  })

  it('sends bearer auth and the ImmutableId Prefer header, merged with extra prefers', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'm1' }))
    const out = await graphFetch<{ id: string }>('tenant-1', '/users/a%40b.com/messages', {
      method: 'POST',
      body: { subject: 'x' },
      prefer: ['odata.maxpagesize=50'],
    })
    expect(out).toEqual({ id: 'm1' })
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://graph.microsoft.com/v1.0/users/a%40b.com/messages')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers.Prefer).toBe('IdType="ImmutableId", odata.maxpagesize=50')
    expect(headers['Content-Type']).toBe('application/json')
  })
  it('returns undefined on 202', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }))
    expect(await graphFetch('tenant-1', '/x', { method: 'POST' })).toBeUndefined()
  })
  it('accepts absolute Graph URLs (delta links) but rejects other hosts', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { value: [] }))
    await graphFetch('tenant-1', 'https://graph.microsoft.com/v1.0/users/x/delta?token=1')
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/users/x/delta?token=1')
    await expect(graphFetch('tenant-1', 'https://evil.example/steal')).rejects.toThrow(/non-Graph URL/)
  })
  it('maps 429 to GraphThrottledError with Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: { code: 'TooManyRequests', message: 'slow down' } }, { 'retry-after': '17' }))
    const err = await graphFetch('tenant-1', '/x').catch((e) => e)
    expect(err).toBeInstanceOf(GraphThrottledError)
    expect(err.retryAfterSeconds).toBe(17)
  })
  it('maps 403 to GraphAuthError', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: { code: 'ErrorAccessDenied', message: 'no' } }))
    await expect(graphFetch('tenant-1', '/x')).rejects.toBeInstanceOf(GraphAuthError)
  })
  it('maps other failures to GraphError with status and code', async () => {
    fetchMock.mockResolvedValueOnce(json(410, { error: { code: 'SyncStateNotFound', message: 'gone' } }))
    const err = await graphFetch('tenant-1', '/x').catch((e) => e)
    expect(err).toBeInstanceOf(GraphError)
    expect(err.status).toBe(410)
    expect(err.code).toBe('SyncStateNotFound')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/email/graph/client.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// Minimal Microsoft Graph client: app-only (client-credentials) auth against a
// single sending tenant, plus a fetch wrapper that maps HTTP failures onto
// typed errors the send queue / inbox monitor act on.

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const GRAPH_ORIGIN = 'https://graph.microsoft.com/'
const LOGIN_BASE = 'https://login.microsoftonline.com'
const REQUEST_TIMEOUT_MS = 20_000

export class GraphError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message)
    this.name = 'GraphError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** 401/403 or token failure: consent revoked, secret expired, or mailbox outside the access policy. */
export class GraphAuthError extends GraphError {
  constructor(message: string, status: number, code?: string) {
    super(message, status, code)
    this.name = 'GraphAuthError'
  }
}

/** 429/503: back off for retryAfterSeconds. */
export class GraphThrottledError extends GraphError {
  constructor(message: string, status: number, public readonly retryAfterSeconds: number) {
    super(message, status)
    this.name = 'GraphThrottledError'
  }
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export function __resetGraphTokenCache(): void {
  tokenCache.clear()
}

export async function getGraphToken(tenantId: string): Promise<string> {
  const cached = tokenCache.get(tenantId)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const clientId = process.env.MS_GRAPH_CLIENT_ID
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET are not set')
  }

  const res = await fetch(`${LOGIN_BASE}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GraphAuthError(`Graph token request failed (${res.status}): ${text.slice(0, 300)}`, res.status)
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache.set(tenantId, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 })
  return json.access_token
}

export interface GraphRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  prefer?: string[]
}

export async function graphFetch<T>(
  tenantId: string,
  pathOrUrl: string,
  opts: GraphRequestOptions = {},
): Promise<T> {
  let url: string
  if (pathOrUrl.startsWith('https://')) {
    // Delta/next links come back from Graph and are stored in the DB. Never
    // send our bearer token anywhere else.
    if (!pathOrUrl.startsWith(GRAPH_ORIGIN)) throw new Error(`Refusing to call non-Graph URL: ${pathOrUrl}`)
    url = pathOrUrl
  } else {
    url = `${GRAPH_BASE}${pathOrUrl}`
  }

  const token = await getGraphToken(tenantId)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Prefer: ['IdType="ImmutableId"', ...(opts.prefer ?? [])].join(', '),
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (res.status === 202 || res.status === 204) return undefined as T
  if (res.ok) return (await res.json()) as T

  const text = await res.text().catch(() => '')
  let message = text.slice(0, 300)
  let code: string | undefined
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } }
    code = parsed.error?.code
    message = parsed.error?.message ?? message
  } catch {
    // non-JSON error body
  }

  if (res.status === 429 || res.status === 503) {
    const retryAfter = Number(res.headers.get('retry-after'))
    throw new GraphThrottledError(message, res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60)
  }
  if (res.status === 401) {
    tokenCache.delete(tenantId)
    throw new GraphAuthError(message, 401, code)
  }
  if (res.status === 403) throw new GraphAuthError(message, 403, code)
  throw new GraphError(message, res.status, code)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/email/graph/client.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/email/graph/client*
git commit -m "feat(email): Microsoft Graph client with app-only auth and typed errors"
```

---

### Task 6: Graph mail operations and `GraphEmailProvider`

**Files:**
- Create: `src/lib/email/graph/mail.ts`
- Test: `src/lib/email/graph/mail.test.ts`
- Create: `src/lib/email/graph/provider.ts`
- Test: `src/lib/email/graph/provider.test.ts`
- Modify: `src/lib/email/provider.ts`
- Modify: `src/lib/email/index.ts`

**Interfaces:**
- Consumes: `graphFetch` and the error classes from Task 5.
- Produces, in `mail.ts`:
  - `interface GraphMessage { id: string; conversationId?: string; subject?: string; from?: { emailAddress?: { address?: string; name?: string } }; receivedDateTime?: string; sentDateTime?: string; isDraft?: boolean; body?: { contentType: string; content: string }; bodyPreview?: string; internetMessageHeaders?: { name: string; value: string }[]; '@removed'?: unknown }`
  - `createDraftMessage(tenantId, mailbox, c: { to: string; subject: string; text: string }): Promise<{ id: string; conversationId: string | null }>`
  - `createReplyDraft(tenantId, mailbox, replyToId: string, c: { to; subject; text }): Promise<{ id: string; conversationId: string | null }>`
  - `sendDraftMessage(tenantId, mailbox, id): Promise<void>`
  - `getMessageState(tenantId, mailbox, id): Promise<{ state: 'SENT' | 'DRAFT' | 'MISSING'; conversationId: string | null }>`
  - `fetchFolderDelta(tenantId, mailbox, folder: 'inbox' | 'sentitems', resumeLink: string | null, since: Date, maxPages?: number): Promise<{ messages: GraphMessage[]; resumeLink: string }>`
  - `sendMailAsText(tenantId, fromMailbox, to, subject, text): Promise<void>`
  - `listTenantUsers(tenantId): Promise<{ id: string; email: string; displayName: string }[]>`
- Produces, in `provider.ts`:
  - `class GraphEmailProvider implements EmailProvider { constructor(tenantId: string) }`
  - `appendUnsubscribeFooter(body: string, lu?: { url: string }): string`
- Produces, in `index.ts`: `getEmailProvider(opts?: { msTenantId?: string | null }): EmailProvider`
- `SendEmailInput` gains `replyToProviderMessageId?: string` and
  `onPrepared?: (providerMessageId: string) => Promise<void>`.
- `SendEmailOutput` becomes
  `{ sgMessageId: string | null; providerMessageId?: string | null; conversationId?: string | null }`.

- [ ] **Step 1: Extend the provider interface**

In `src/lib/email/provider.ts`, add to `SendEmailInput` after `references?`:

```ts
  // Provider-native threading (Microsoft Graph): reply to this previously sent
  // message via createReply, so Exchange sets In-Reply-To/References itself.
  // SendGrid ignores it and uses messageId/inReplyTo/references instead.
  replyToProviderMessageId?: string
  // Called after the provider has created the outgoing message but BEFORE it
  // is sent. The caller persists the id so a crash between send and DB write
  // can be reconciled without a duplicate send. SendGrid never calls it.
  onPrepared?: (providerMessageId: string) => Promise<void>
```

Replace `SendEmailOutput` with:

```ts
export interface SendEmailOutput {
  sgMessageId: string | null
  // Graph: immutable message id + conversation id (null/undefined for SendGrid).
  providerMessageId?: string | null
  conversationId?: string | null
}
```

- [ ] **Step 2: Write the failing mail-operation tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return { ...actual, graphFetch: vi.fn() }
})

import { graphFetch, GraphError } from './client'
import {
  createDraftMessage,
  createReplyDraft,
  sendDraftMessage,
  getMessageState,
  fetchFolderDelta,
  sendMailAsText,
  listTenantUsers,
} from './mail'

const gf = graphFetch as ReturnType<typeof vi.fn>
beforeEach(() => gf.mockReset())

describe('Graph mail operations', () => {
  it('createDraftMessage posts a text message to the mailbox', async () => {
    gf.mockResolvedValueOnce({ id: 'd1', conversationId: 'c1' })
    const out = await createDraftMessage('t', 'mike@x.com', { to: 'jane@a.com', subject: 'S', text: 'B' })
    expect(out).toEqual({ id: 'd1', conversationId: 'c1' })
    expect(gf).toHaveBeenCalledWith('t', '/users/mike%40x.com/messages', {
      method: 'POST',
      body: { subject: 'S', body: { contentType: 'Text', content: 'B' }, toRecipients: [{ emailAddress: { address: 'jane@a.com' } }] },
    })
  })

  it('createReplyDraft calls createReply then PATCHes subject, body and recipient', async () => {
    gf.mockResolvedValueOnce({ id: 'r1', conversationId: 'c1' }).mockResolvedValueOnce({})
    const out = await createReplyDraft('t', 'mike@x.com', 'prior-1', { to: 'jane@a.com', subject: 'Re: S', text: 'B2' })
    expect(out).toEqual({ id: 'r1', conversationId: 'c1' })
    expect(gf.mock.calls[0]).toEqual(['t', '/users/mike%40x.com/messages/prior-1/createReply', { method: 'POST', body: {} }])
    expect(gf.mock.calls[1]).toEqual([
      't',
      '/users/mike%40x.com/messages/r1',
      {
        method: 'PATCH',
        body: { subject: 'Re: S', body: { contentType: 'Text', content: 'B2' }, toRecipients: [{ emailAddress: { address: 'jane@a.com' } }] },
      },
    ])
  })

  it('sendDraftMessage posts /send', async () => {
    gf.mockResolvedValueOnce(undefined)
    await sendDraftMessage('t', 'mike@x.com', 'd1')
    expect(gf).toHaveBeenCalledWith('t', '/users/mike%40x.com/messages/d1/send', { method: 'POST' })
  })

  it('getMessageState maps isDraft and 404', async () => {
    gf.mockResolvedValueOnce({ id: 'd1', isDraft: false, conversationId: 'c1' })
    expect(await getMessageState('t', 'mike@x.com', 'd1')).toEqual({ state: 'SENT', conversationId: 'c1' })
    gf.mockResolvedValueOnce({ id: 'd1', isDraft: true, conversationId: 'c1' })
    expect((await getMessageState('t', 'mike@x.com', 'd1')).state).toBe('DRAFT')
    gf.mockRejectedValueOnce(new GraphError('nope', 404, 'ErrorItemNotFound'))
    expect(await getMessageState('t', 'mike@x.com', 'd1')).toEqual({ state: 'MISSING', conversationId: null })
  })

  it('fetchFolderDelta starts with a receivedDateTime filter and follows nextLink to the deltaLink', async () => {
    gf.mockResolvedValueOnce({ value: [{ id: 'm1' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next1' })
      .mockResolvedValueOnce({ value: [{ id: 'm2' }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta1' })
    const out = await fetchFolderDelta('t', 'mike@x.com', 'inbox', null, new Date('2026-09-22T00:00:00Z'))
    expect(out.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(out.resumeLink).toBe('https://graph.microsoft.com/v1.0/delta1')
    const firstUrl = gf.mock.calls[0][1] as string
    expect(firstUrl).toContain('/users/mike%40x.com/mailFolders/inbox/messages/delta?')
    expect(decodeURIComponent(firstUrl)).toContain('$filter=receivedDateTime ge 2026-09-22T00:00:00.000Z')
    expect(gf.mock.calls[0][2]).toEqual({ prefer: ['odata.maxpagesize=50', 'outlook.body-content-type="text"'] })
  })

  it('fetchFolderDelta resumes from a stored link and returns the nextLink when pages run out', async () => {
    gf.mockResolvedValueOnce({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next2' })
    const out = await fetchFolderDelta('t', 'mike@x.com', 'inbox', 'https://graph.microsoft.com/v1.0/delta1', new Date(), 1)
    expect(gf.mock.calls[0][1]).toBe('https://graph.microsoft.com/v1.0/delta1')
    expect(out.resumeLink).toBe('https://graph.microsoft.com/v1.0/next2')
  })

  it('sendMailAsText uses sendMail without saving to Sent Items', async () => {
    gf.mockResolvedValueOnce(undefined)
    await sendMailAsText('t', 'alerts@x.com', 'boss@work.com', 'Subj', 'Text')
    expect(gf).toHaveBeenCalledWith('t', '/users/alerts%40x.com/sendMail', {
      method: 'POST',
      body: {
        message: { subject: 'Subj', body: { contentType: 'Text', content: 'Text' }, toRecipients: [{ emailAddress: { address: 'boss@work.com' } }] },
        saveToSentItems: false,
      },
    })
  })

  it('listTenantUsers keeps users with a mail address, following pages', async () => {
    gf.mockResolvedValueOnce({
      value: [{ id: 'u1', mail: 'mike@x.com', displayName: 'Mike' }, { id: 'u2', mail: null, displayName: 'Room' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?page=2',
    }).mockResolvedValueOnce({ value: [{ id: 'u3', mail: 'amy@x.com', displayName: 'Amy' }] })
    expect(await listTenantUsers('t')).toEqual([
      { id: 'u1', email: 'mike@x.com', displayName: 'Mike' },
      { id: 'u3', email: 'amy@x.com', displayName: 'Amy' },
    ])
  })
})
```

- [ ] **Step 3: Write the failing provider tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./mail', () => ({
  createDraftMessage: vi.fn(),
  createReplyDraft: vi.fn(),
  sendDraftMessage: vi.fn(),
}))

import { createDraftMessage, createReplyDraft, sendDraftMessage } from './mail'
import { GraphEmailProvider, appendUnsubscribeFooter } from './provider'

const create = createDraftMessage as ReturnType<typeof vi.fn>
const reply = createReplyDraft as ReturnType<typeof vi.fn>
const send = sendDraftMessage as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  create.mockResolvedValue({ id: 'd1', conversationId: 'c1' })
  reply.mockResolvedValue({ id: 'r1', conversationId: 'c1' })
  send.mockResolvedValue(undefined)
})

const input = { to: 'jane@a.com', fromEmail: 'mike@x.com', fromName: 'Mike', subject: 'S', body: 'Hello' }

describe('GraphEmailProvider', () => {
  it('first send: creates a draft, calls onPrepared with its id BEFORE sending, returns ids', async () => {
    const order: string[] = []
    send.mockImplementation(async () => { order.push('send') })
    const onPrepared = vi.fn(async (id: string) => { order.push(`prepared:${id}`) })
    const out = await new GraphEmailProvider('t').sendEmail({ ...input, onPrepared })
    expect(order).toEqual(['prepared:d1', 'send'])
    expect(create).toHaveBeenCalledWith('t', 'mike@x.com', { to: 'jane@a.com', subject: 'S', text: 'Hello' })
    expect(out).toEqual({ sgMessageId: null, providerMessageId: 'd1', conversationId: 'c1' })
  })

  it('follow-up: uses createReply on the prior message', async () => {
    await new GraphEmailProvider('t').sendEmail({ ...input, subject: 'Re: S', replyToProviderMessageId: 'prior-1' })
    expect(reply).toHaveBeenCalledWith('t', 'mike@x.com', 'prior-1', { to: 'jane@a.com', subject: 'Re: S', text: 'Hello' })
    expect(create).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('t', 'mike@x.com', 'r1')
  })

  it('appends the unsubscribe link to the body', async () => {
    await new GraphEmailProvider('t').sendEmail({ ...input, listUnsubscribe: { url: 'https://app/u?token=abc' } })
    expect(create.mock.calls[0][2].text).toBe(appendUnsubscribeFooter('Hello', { url: 'https://app/u?token=abc' }))
    expect(create.mock.calls[0][2].text).toContain('https://app/u?token=abc')
  })

  it('does not send when onPrepared throws (id could not be persisted)', async () => {
    await expect(
      new GraphEmailProvider('t').sendEmail({ ...input, onPrepared: async () => { throw new Error('db down') } }),
    ).rejects.toThrow('db down')
    expect(send).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx vitest run src/lib/email/graph`
Expected: FAIL, `./mail` and `./provider` not found.

- [ ] **Step 5: Implement `mail.ts`**

```ts
import { graphFetch, GraphError } from './client'

export interface GraphMessage {
  id: string
  conversationId?: string
  subject?: string
  from?: { emailAddress?: { address?: string; name?: string } }
  receivedDateTime?: string
  sentDateTime?: string
  isDraft?: boolean
  body?: { contentType: string; content: string }
  bodyPreview?: string
  internetMessageHeaders?: { name: string; value: string }[]
  '@removed'?: unknown
}

interface OutgoingContent {
  to: string
  subject: string
  text: string
}

const mailboxPath = (mailbox: string) => `/users/${encodeURIComponent(mailbox)}`

const DELTA_SELECT =
  'id,conversationId,subject,from,receivedDateTime,sentDateTime,isDraft,body,bodyPreview,internetMessageHeaders'

function messageBody(c: OutgoingContent) {
  return {
    subject: c.subject,
    body: { contentType: 'Text', content: c.text },
    toRecipients: [{ emailAddress: { address: c.to } }],
  }
}

export async function createDraftMessage(
  tenantId: string,
  mailbox: string,
  c: OutgoingContent,
): Promise<{ id: string; conversationId: string | null }> {
  const draft = await graphFetch<GraphMessage>(tenantId, `${mailboxPath(mailbox)}/messages`, {
    method: 'POST',
    body: messageBody(c),
  })
  return { id: draft.id, conversationId: draft.conversationId ?? null }
}

/**
 * Reply to a message WE sent earlier. createReply addresses the reply to the
 * original sender (us), so the PATCH overrides recipients with the lead.
 */
export async function createReplyDraft(
  tenantId: string,
  mailbox: string,
  replyToId: string,
  c: OutgoingContent,
): Promise<{ id: string; conversationId: string | null }> {
  const draft = await graphFetch<GraphMessage>(
    tenantId,
    `${mailboxPath(mailbox)}/messages/${replyToId}/createReply`,
    { method: 'POST', body: {} },
  )
  await graphFetch(tenantId, `${mailboxPath(mailbox)}/messages/${draft.id}`, {
    method: 'PATCH',
    body: messageBody(c),
  })
  return { id: draft.id, conversationId: draft.conversationId ?? null }
}

export async function sendDraftMessage(tenantId: string, mailbox: string, id: string): Promise<void> {
  await graphFetch(tenantId, `${mailboxPath(mailbox)}/messages/${id}/send`, { method: 'POST' })
}

export async function getMessageState(
  tenantId: string,
  mailbox: string,
  id: string,
): Promise<{ state: 'SENT' | 'DRAFT' | 'MISSING'; conversationId: string | null }> {
  try {
    const m = await graphFetch<GraphMessage>(
      tenantId,
      `${mailboxPath(mailbox)}/messages/${id}?$select=id,isDraft,conversationId`,
    )
    return { state: m.isDraft ? 'DRAFT' : 'SENT', conversationId: m.conversationId ?? null }
  } catch (err) {
    if (err instanceof GraphError && err.status === 404) return { state: 'MISSING', conversationId: null }
    throw err
  }
}

/**
 * Pull changes for a folder. `resumeLink` is whatever we stored last time
 * (a deltaLink, or a nextLink if we stopped mid-sync). With no link we start a
 * fresh sync limited to mail received since `since`. Returns the link to store.
 */
export async function fetchFolderDelta(
  tenantId: string,
  mailbox: string,
  folder: 'inbox' | 'sentitems',
  resumeLink: string | null,
  since: Date,
  maxPages = 10,
): Promise<{ messages: GraphMessage[]; resumeLink: string }> {
  let url =
    resumeLink ??
    `${mailboxPath(mailbox)}/mailFolders/${folder}/messages/delta?$select=${DELTA_SELECT}&$filter=${encodeURIComponent(
      `receivedDateTime ge ${since.toISOString()}`,
    )}`
  const messages: GraphMessage[] = []

  for (let page = 0; page < maxPages; page++) {
    const res = await graphFetch<{
      value: GraphMessage[]
      '@odata.nextLink'?: string
      '@odata.deltaLink'?: string
    }>(tenantId, url, { prefer: ['odata.maxpagesize=50', 'outlook.body-content-type="text"'] })
    messages.push(...res.value)
    if (res['@odata.deltaLink']) return { messages, resumeLink: res['@odata.deltaLink'] }
    if (!res['@odata.nextLink']) break
    url = res['@odata.nextLink']
  }
  return { messages, resumeLink: url }
}

export async function sendMailAsText(
  tenantId: string,
  fromMailbox: string,
  to: string,
  subject: string,
  text: string,
): Promise<void> {
  await graphFetch(tenantId, `${mailboxPath(fromMailbox)}/sendMail`, {
    method: 'POST',
    body: { message: messageBody({ to, subject, text }), saveToSentItems: false },
  })
}

export async function listTenantUsers(
  tenantId: string,
): Promise<{ id: string; email: string; displayName: string }[]> {
  const out: { id: string; email: string; displayName: string }[] = []
  let url: string | undefined = '/users?$select=id,displayName,mail&$top=999'
  while (url) {
    const res: { value: { id: string; mail: string | null; displayName: string }[]; '@odata.nextLink'?: string } =
      await graphFetch(tenantId, url)
    for (const u of res.value) if (u.mail) out.push({ id: u.id, email: u.mail, displayName: u.displayName })
    url = res['@odata.nextLink']
  }
  return out
}
```

- [ ] **Step 6: Implement `provider.ts`**

```ts
import type { EmailProvider, SendEmailInput, SendEmailOutput } from '../provider'
import { createDraftMessage, createReplyDraft, sendDraftMessage } from './mail'

// Graph can't set List-Unsubscribe (only X- headers are allowed), so the
// unsubscribe intent is carried as a plain link at the end of the body.
export function appendUnsubscribeFooter(body: string, lu?: { url: string }): string {
  if (!lu) return body
  return `${body.trimEnd()}\n\n--\nIf you'd prefer not to hear from me again, unsubscribe here: ${lu.url}`
}

export class GraphEmailProvider implements EmailProvider {
  constructor(private readonly tenantId: string) {}

  async sendEmail(input: SendEmailInput): Promise<SendEmailOutput> {
    const content = {
      to: input.to,
      subject: input.subject,
      text: appendUnsubscribeFooter(input.body, input.listUnsubscribe),
    }
    const draft = input.replyToProviderMessageId
      ? await createReplyDraft(this.tenantId, input.fromEmail, input.replyToProviderMessageId, content)
      : await createDraftMessage(this.tenantId, input.fromEmail, content)

    // Persist the id BEFORE sending: if we crash after /send, the next attempt
    // finds it in Sent Items instead of sending twice.
    if (input.onPrepared) await input.onPrepared(draft.id)

    await sendDraftMessage(this.tenantId, input.fromEmail, draft.id)
    return { sgMessageId: null, providerMessageId: draft.id, conversationId: draft.conversationId }
  }
}
```

- [ ] **Step 7: Update `src/lib/email/index.ts`**

```ts
import { SendGridProvider } from './sendgrid'
import { GraphEmailProvider } from './graph/provider'
import type { EmailProvider } from './provider'

// Per-process singletons. Reset on serverless cold starts (harmless).
let _sendgrid: EmailProvider | null = null
const _graph = new Map<string, EmailProvider>()

/**
 * Microsoft Graph when the org has connected a Microsoft 365 tenant and the
 * app registration is configured; SendGrid otherwise (legacy / local dev).
 */
export function getEmailProvider(opts: { msTenantId?: string | null } = {}): EmailProvider {
  if (opts.msTenantId && process.env.MS_GRAPH_CLIENT_ID) {
    let provider = _graph.get(opts.msTenantId)
    if (!provider) {
      provider = new GraphEmailProvider(opts.msTenantId)
      _graph.set(opts.msTenantId, provider)
    }
    return provider
  }

  if (_sendgrid) return _sendgrid
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) throw new Error('SENDGRID_API_KEY is not set')
  _sendgrid = new SendGridProvider(apiKey)
  return _sendgrid
}

export type { EmailProvider, SendEmailInput, SendEmailOutput } from './provider'
```

- [ ] **Step 8: Run the tests and typecheck**

Run: `npx vitest run src/lib/email && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 9: Commit**

```bash
git add src/lib/email
git commit -m "feat(email): GraphEmailProvider with createReply threading and pre-send id persistence"
```

---

### Task 7: Shared mailbox slots, and `sendDraft` on Graph

**Files:**
- Create: `src/features/mailboxes/server/mailbox-slots.ts`
- Test: `src/features/mailboxes/server/mailbox-slots.test.ts`
- Modify: `src/features/messages/server/send-draft.ts`
- Modify: `src/features/messages/server/send-draft.test.ts`

**Interfaces:**
- Produces:
  - `startOfDay(d: Date): Date`
  - `reserveMailboxSlot(mailboxId: string, limitToday: number, startOfToday: Date): Promise<boolean>`
  - `releaseMailboxSlot(mailboxId: string): Promise<void>`
- Consumes: `getEmailProvider({ msTenantId })` and the new `SendEmailInput`
  fields (Task 6).

- [ ] **Step 1: Write the failing slot tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { mailbox: { updateMany: vi.fn() } } }))

import { prisma } from '@/lib/db/prisma'
import { reserveMailboxSlot, releaseMailboxSlot, startOfDay } from './mailbox-slots'

const updateMany = prisma.mailbox.updateMany as ReturnType<typeof vi.fn>
beforeEach(() => updateMany.mockReset())

describe('mailbox slots', () => {
  it('reserve: lazy reset then conditional increment guarded by limit and pause flags', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 })
    const sod = startOfDay(new Date('2026-09-23T15:00:00'))
    expect(await reserveMailboxSlot('mb-1', 30, sod)).toBe(true)
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'mb-1', lastResetAt: { lt: sod } },
      data: { sentToday: 0, lastResetAt: sod },
    })
    expect(updateMany.mock.calls[1][0]).toEqual({
      where: { id: 'mb-1', isActive: true, autoPaused: false, sentToday: { lt: 30 } },
      data: { sentToday: { increment: 1 } },
    })
  })
  it('reserve returns false at the limit', async () => {
    updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 })
    expect(await reserveMailboxSlot('mb-1', 30, new Date())).toBe(false)
  })
  it('release never underflows', async () => {
    updateMany.mockResolvedValueOnce({ count: 1 })
    await releaseMailboxSlot('mb-1')
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'mb-1', sentToday: { gt: 0 } },
      data: { sentToday: { decrement: 1 } },
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/mailboxes/server/mailbox-slots.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Create `mailbox-slots.ts`**

Move `startOfDay`, `reserveMailboxSlot`, and `releaseMailboxSlot` out of
`send-draft.ts` verbatim, including their doc comments, and export all three.
Add the import `import { prisma } from '@/lib/db/prisma'` at the top.

- [ ] **Step 4: Update `send-draft.ts` to import them and thread via Graph**

1. Delete the local `startOfDay`, `reserveMailboxSlot`, and
   `releaseMailboxSlot` definitions, and add:

   ```ts
   import { startOfDay, reserveMailboxSlot, releaseMailboxSlot } from '@/features/mailboxes/server/mailbox-slots'
   ```

2. After the terminal-state check (step 2b), load the org's tenant:

   ```ts
   const org = await prisma.organization.findUnique({
     where: { id: organizationId },
     select: { msTenantId: true },
   })
   ```

3. In the `priorMessages` query, change `select` to
   `{ messageId: true, subject: true, graphMessageId: true }`. After computing
   `references`, add:

   ```ts
   // Graph threads by replying to the most recent prior message it sent.
   const replyToProviderMessageId =
     [...priorMessages].reverse().find((m) => m.graphMessageId)?.graphMessageId ?? undefined
   ```

4. Replace the `let sgMessageId …` send block (step 6) with:

   ```ts
   let sent: Awaited<ReturnType<ReturnType<typeof getEmailProvider>['sendEmail']>>
   try {
     sent = await getEmailProvider({ msTenantId: org?.msTenantId }).sendEmail({
       to: draft.lead.email,
       fromEmail: sendingMailbox.email,
       fromName: sendingMailbox.displayName,
       subject: effectiveSubject,
       body: draft.body,
       customArgs: { draftId, leadId: draft.leadId },
       listUnsubscribe: { url: unsubscribeUrl },
       messageId,
       ...(inReplyTo && { inReplyTo }),
       ...(references && references.length > 0 && { references }),
       ...(replyToProviderMessageId && { replyToProviderMessageId }),
       onPrepared: async (providerMessageId) => {
         await prisma.outboundMessage.update({ where: { id: claim.id }, data: { graphMessageId: providerMessageId } })
       },
     })
   } catch (sendErr) {
   ```

   Keep the existing `catch` body unchanged.

5. In the finalize `tx.outboundMessage.update`, change `data` to:

   ```ts
   data: {
     status: 'SENT',
     sgMessageId: sent.sgMessageId,
     sentAt,
     mailboxId: sendingMailbox.id,
     ...(sent.providerMessageId && { graphMessageId: sent.providerMessageId }),
     ...(sent.conversationId && { conversationId: sent.conversationId }),
   },
   ```

- [ ] **Step 5: Update `send-draft.test.ts` for the new org lookup, then add Graph tests**

1. In the `vi.mock('@/lib/db/prisma', …)` factory, add
   `organization: { findUnique: vi.fn() },`.
2. Add `organization: { findUnique: Fn }` to the `mockPrisma` type.
3. In `beforeEach`, add
   `mockPrisma.organization.findUnique.mockResolvedValue({ msTenantId: null })`.
4. Append inside the `describe` block:

```ts
  it('uses the org tenant when selecting the provider', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ msTenantId: 'tenant-1' })
    await sendDraft(INPUT)
    expect(mockGetEmailProvider).toHaveBeenCalledWith({ msTenantId: 'tenant-1' })
  })

  it('Graph follow-up: replies to the most recent prior graph message', async () => {
    mockPrisma.draft.findFirst.mockResolvedValue({ ...fakeDraft, sequenceEnrollmentId: 'enr-1' })
    mockPrisma.outboundMessage.findMany.mockResolvedValue([
      { messageId: '<m1@app.test>', subject: 'Intro', graphMessageId: 'g1' },
      { messageId: '<m2@app.test>', subject: 'Re: Intro', graphMessageId: 'g2' },
    ])
    await sendDraft(INPUT)
    const sent = mockSendEmail.mock.calls[0]?.[0] as { replyToProviderMessageId?: string }
    expect(sent.replyToProviderMessageId).toBe('g2')
  })

  it('persists the Graph id via onPrepared and stores ids on finalize', async () => {
    mockSendEmail.mockImplementation(async (input: { onPrepared?: (id: string) => Promise<void> }) => {
      await input.onPrepared?.('g-new')
      return { sgMessageId: null, providerMessageId: 'g-new', conversationId: 'conv-1' }
    })
    const result = await sendDraft(INPUT)
    expect(mockPrisma.outboundMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { graphMessageId: 'g-new' },
    })
    expect(result.status).toBe('SENT')
  })
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/mailboxes src/features/messages && npx tsc --noEmit`
Expected: PASS, including all pre-existing `sendDraft` tests.

- [ ] **Step 7: Commit**

```bash
git add src/features/mailboxes/server/mailbox-slots* src/features/messages/server/send-draft*
git commit -m "refactor(messages): share mailbox slot helpers; sendDraft threads and records ids via Graph"
```

---

### Task 8: AI personalization line

**Files:**
- Modify: `src/lib/ai/provider.ts`
- Modify: `src/lib/ai/openai.ts`
- Modify: `src/lib/ai/index.ts`
- Test: `src/lib/ai/openai.test.ts` (add cases)

**Interfaces:**
- Produces:
  - `interface PersonalizeInput { firstName?: string | null; lastName?: string | null; company?: string | null; title?: string | null; customFields?: unknown }`
  - `AIProvider.personalize(input: PersonalizeInput, instructions: string): Promise<string>`,
    which throws `DraftGenerationError` on failure or empty output.

- [ ] **Step 1: Read how `openai.test.ts` mocks the client**

Run: `sed -n 1,60p src/lib/ai/openai.test.ts`
Reuse the same `create` mock handle in the new tests. The step below assumes
it is exposed as `mockCreate`; rename to match the file if needed.

- [ ] **Step 2: Write the failing tests (append to `openai.test.ts`)**

```ts
describe('OpenAIProvider.personalize', () => {
  it('returns the trimmed line from a JSON object and fences lead data as untrusted', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '{"line":"  Saw you manage 4 plazas in Amherst. "}' } }] })
    const provider = new OpenAIProvider('k', 'gpt-4o')
    const line = await provider.personalize(
      { firstName: 'Jane', company: 'Acme PM', customFields: { city: 'Amherst' } },
      'Mention their city.',
    )
    expect(line).toBe('Saw you manage 4 plazas in Amherst.')
    const args = mockCreate.mock.calls.at(-1)![0]
    expect(args.response_format).toEqual({ type: 'json_object' })
    expect(args.messages[0].content).toContain('Mention their city.')
    expect(args.messages[0].content).toContain('SECURITY:')
    expect(args.messages[1].content).toMatch(/<<lead:/)
  })

  it('throws DraftGenerationError on an empty line', async () => {
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: '{"line":""}' } }] })
    await expect(new OpenAIProvider('k', 'gpt-4o').personalize({}, 'x')).rejects.toBeInstanceOf(DraftGenerationError)
  })

  it('throws DraftGenerationError on transport failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('timeout'))
    await expect(new OpenAIProvider('k', 'gpt-4o').personalize({}, 'x')).rejects.toBeInstanceOf(DraftGenerationError)
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/ai/openai.test.ts`
Expected: FAIL, `provider.personalize is not a function`.

- [ ] **Step 4: Implement**

In `provider.ts`, add:

```ts
export interface PersonalizeInput {
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  title?: string | null
  customFields?: unknown
}
```

Add to `interface AIProvider`:

```ts
  /** One or two sentences, per `instructions`, grounded ONLY in the lead's data. */
  personalize(input: PersonalizeInput, instructions: string): Promise<string>
```

In `index.ts`, add `PersonalizeInput` to the type exports.

In `openai.ts`, add `PersonalizeInput` to the type import and add this method
to `OpenAIProvider`:

```ts
  async personalize(input: PersonalizeInput, instructions: string): Promise<string> {
    const leadData = JSON.stringify({
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      company: input.company ?? null,
      title: input.title ?? null,
      details: input.customFields && typeof input.customFields === 'object' ? input.customFields : null,
    })

    const systemPrompt = `You write ONE personalized opening line for a short B2B cold email.
Guidance from the sender: ${instructions}

Rules: 1–2 sentences, under 40 words, plain text, no greeting, no sign-off.
Use ONLY facts present in the lead data; if nothing relevant is there, write a
brief, generic but natural line. Never mention prices, discounts, guarantees,
or anything free.

${UNTRUSTED_DATA_PREAMBLE}

Return a JSON object: { "line": "<the sentence(s)>" }`

    let content: string
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fenceUntrusted('lead', leadData) },
        ],
        temperature: 0.7,
        response_format: JSON_RESPONSE_FORMAT,
      })
      content = response.choices[0]?.message.content ?? ''
    } catch (err) {
      throw new DraftGenerationError('AI personalization failed.', err)
    }

    let line = ''
    try {
      const parsed = JSON.parse(content) as { line?: unknown }
      line = typeof parsed.line === 'string' ? parsed.line.trim() : ''
    } catch (err) {
      throw new DraftGenerationError('AI personalization returned invalid JSON.', err)
    }
    if (!line) throw new DraftGenerationError('AI personalization returned an empty line.')
    return line
  }
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run src/lib/ai && npx tsc --noEmit`
Expected: PASS. If `tsc` flags a test fake that implements the full
`AIProvider`, add `personalize: vi.fn()` to it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai
git commit -m "feat(ai): personalize() writes a guarded one-line opener from lead data"
```

---

### Task 9: Notification emails

**Files:**
- Create: `src/features/replies/server/notify.ts`
- Test: `src/features/replies/server/notify.test.ts`

**Interfaces:**
- Consumes: `sendMailAsText` (Task 6).
- Produces:
  - `buildReplyNotification(i: ReplyNotificationInput): { subject: string; text: string }`
  - `notifyReply(replyId: string): Promise<boolean>`
  - `notifyUnmatchedReply(unmatchedId: string): Promise<boolean>`
  - `sendOrgAlert(organizationId: string, subject: string, text: string): Promise<boolean>`

  All three `notify*`/`send*` functions return `true` if sent, `false` if
  skipped or failed. They never throw.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    inboundReply: { findUnique: vi.fn(), update: vi.fn() },
    unmatchedReply: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/email/graph/mail', () => ({ sendMailAsText: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { sendMailAsText } from '@/lib/email/graph/mail'
import { buildReplyNotification, notifyReply, notifyUnmatchedReply, sendOrgAlert } from './notify'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  organization: { findUnique: Fn }
  inboundReply: { findUnique: Fn; update: Fn }
  unmatchedReply: { findUnique: Fn; update: Fn }
}
const send = sendMailAsText as Fn

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MS_NOTIFY_MAILBOX = 'alerts@getacmesnow.com'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
  p.organization.findUnique.mockResolvedValue({ escalationEmail: 'justin@work.com', msTenantId: 'tenant-1' })
})

const reply = {
  id: 'r1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  notifiedAt: null,
  classification: 'POSITIVE',
  classificationConfidence: 0.92,
  rawBody: 'Yes — can you quote our 3 lots?\nThanks',
  lead: { firstName: 'Jane', lastName: 'Doe', email: 'jane@acmepm.com', company: 'Acme PM', title: 'Facilities Manager' },
  mailbox: { email: 'mike@getacmesnow.com' },
  outboundMessage: { campaign: { name: 'Buffalo HOAs' } },
}

describe('buildReplyNotification', () => {
  it('formats subject and body', () => {
    const n = buildReplyNotification({
      classification: 'POSITIVE',
      confidence: 0.92,
      leadName: 'Jane Doe',
      leadEmail: 'jane@acmepm.com',
      company: 'Acme PM',
      title: 'Facilities Manager',
      campaignName: 'Buffalo HOAs',
      mailboxEmail: 'mike@getacmesnow.com',
      replyText: 'Line 1\nLine 2',
      leadUrl: 'https://app.test/leads/lead-1',
    })
    expect(n.subject).toBe('[Reply – POSITIVE] Jane Doe @ Acme PM')
    expect(n.text).toContain('Classification: POSITIVE (92% confidence)')
    expect(n.text).toContain('Answer from this mailbox in Outlook: mike@getacmesnow.com')
    expect(n.text).toContain('> Line 1\n> Line 2')
  })
  it('truncates very long replies', () => {
    const n = buildReplyNotification({
      classification: 'NEUTRAL', confidence: null, leadName: 'X', leadEmail: 'x@y.com', company: null, title: null,
      campaignName: null, mailboxEmail: null, replyText: 'a'.repeat(5000), leadUrl: null,
    })
    expect(n.text.length).toBeLessThan(2300)
    expect(n.text).toContain('…')
  })
})

describe('notifyReply', () => {
  it('sends from MS_NOTIFY_MAILBOX to escalationEmail and stamps notifiedAt', async () => {
    p.inboundReply.findUnique.mockResolvedValue(reply)
    expect(await notifyReply('r1')).toBe(true)
    expect(send).toHaveBeenCalledWith('tenant-1', 'alerts@getacmesnow.com', 'justin@work.com', expect.stringContaining('Jane Doe'), expect.stringContaining('https://app.test/leads/lead-1'))
    expect(p.inboundReply.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { notifiedAt: expect.any(Date) } })
  })
  it('skips already-notified replies', async () => {
    p.inboundReply.findUnique.mockResolvedValue({ ...reply, notifiedAt: new Date() })
    expect(await notifyReply('r1')).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })
  it('returns false without throwing when escalationEmail is missing', async () => {
    p.inboundReply.findUnique.mockResolvedValue(reply)
    p.organization.findUnique.mockResolvedValue({ escalationEmail: null, msTenantId: 'tenant-1' })
    expect(await notifyReply('r1')).toBe(false)
  })
  it('returns false and leaves notifiedAt null when Graph fails', async () => {
    p.inboundReply.findUnique.mockResolvedValue(reply)
    send.mockRejectedValueOnce(new Error('boom'))
    expect(await notifyReply('r1')).toBe(false)
    expect(p.inboundReply.update).not.toHaveBeenCalled()
  })
})

describe('notifyUnmatchedReply', () => {
  it('labels the notification UNMATCHED', async () => {
    p.unmatchedReply.findUnique.mockResolvedValue({
      id: 'u1', organizationId: 'org-1', notifiedAt: null, fromEmail: 'bob@acmepm.com', subject: 'Re: Snow plan',
      bodyPreview: 'Jane is out, I handle this.', mailbox: { email: 'mike@getacmesnow.com' },
    })
    expect(await notifyUnmatchedReply('u1')).toBe(true)
    expect(send.mock.calls[0][3]).toBe('[Reply – UNMATCHED] bob@acmepm.com')
  })
})

describe('sendOrgAlert', () => {
  it('prefixes the subject', async () => {
    expect(await sendOrgAlert('org-1', 'Sending paused', 'why')).toBe(true)
    expect(send.mock.calls[0][3]).toBe('[OutboundOS] Sending paused')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/replies/server/notify.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import { prisma } from '@/lib/db/prisma'
import { sendMailAsText } from '@/lib/email/graph/mail'

// Escalation emails go FROM a shared mailbox in the sending tenant
// (MS_NOTIFY_MAILBOX — no license, never counts against cold-mailbox limits)
// TO the org's escalationEmail. All functions are best-effort: they return
// false instead of throwing so a notification problem never breaks a cron tick;
// the inbox monitor re-sweeps replies whose notifiedAt is still null.

const MAX_QUOTE_CHARS = 2000

export interface ReplyNotificationInput {
  classification: string
  confidence: number | null
  leadName: string
  leadEmail: string
  company: string | null
  title: string | null
  campaignName: string | null
  mailboxEmail: string | null
  replyText: string
  leadUrl: string | null
}

export function buildReplyNotification(i: ReplyNotificationInput): { subject: string; text: string } {
  const who = i.company ? `${i.leadName} @ ${i.company}` : i.leadName
  const trimmed = i.replyText.trim()
  const clipped = trimmed.length > MAX_QUOTE_CHARS ? `${trimmed.slice(0, MAX_QUOTE_CHARS)}…` : trimmed
  const quoted = clipped
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

  const lines = [
    `${i.leadName} <${i.leadEmail}>${i.title ? `, ${i.title}` : ''}${i.company ? ` at ${i.company}` : ''} replied.`,
    '',
    `Classification: ${i.classification}${i.confidence !== null ? ` (${Math.round(i.confidence * 100)}% confidence)` : ''}`,
    ...(i.campaignName ? [`Campaign: ${i.campaignName}`] : []),
    ...(i.mailboxEmail ? [`Answer from this mailbox in Outlook: ${i.mailboxEmail}`] : []),
    ...(i.leadUrl ? [`Lead in OutboundOS: ${i.leadUrl}`] : []),
    '',
    quoted,
  ]
  return { subject: `[Reply – ${i.classification}] ${who}`, text: lines.join('\n') }
}

async function deliver(organizationId: string, subject: string, text: string): Promise<boolean> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { escalationEmail: true, msTenantId: true },
  })
  const from = process.env.MS_NOTIFY_MAILBOX
  if (!org?.escalationEmail || !org.msTenantId || !from) {
    console.warn(`[notify] org ${organizationId}: missing escalationEmail, msTenantId or MS_NOTIFY_MAILBOX — skipped`)
    return false
  }
  try {
    await sendMailAsText(org.msTenantId, from, org.escalationEmail, subject, text)
    return true
  } catch (err) {
    console.error(`[notify] org ${organizationId}: send failed`, err)
    return false
  }
}

function leadUrl(leadId: string): string | null {
  const base = process.env.NEXT_PUBLIC_APP_URL
  return base ? `${base}/leads/${leadId}` : null
}

export async function notifyReply(replyId: string): Promise<boolean> {
  const reply = await prisma.inboundReply.findUnique({
    where: { id: replyId },
    include: {
      lead: { select: { firstName: true, lastName: true, email: true, company: true, title: true } },
      mailbox: { select: { email: true } },
      outboundMessage: { select: { campaign: { select: { name: true } } } },
    },
  })
  if (!reply || reply.notifiedAt) return false

  const leadName = [reply.lead.firstName, reply.lead.lastName].filter(Boolean).join(' ') || reply.lead.email
  const { subject, text } = buildReplyNotification({
    classification: reply.classification,
    confidence: reply.classificationConfidence,
    leadName,
    leadEmail: reply.lead.email,
    company: reply.lead.company,
    title: reply.lead.title,
    campaignName: reply.outboundMessage?.campaign?.name ?? null,
    mailboxEmail: reply.mailbox?.email ?? null,
    replyText: reply.rawBody,
    leadUrl: leadUrl(reply.leadId),
  })

  const ok = await deliver(reply.organizationId, subject, text)
  if (ok) await prisma.inboundReply.update({ where: { id: replyId }, data: { notifiedAt: new Date() } })
  return ok
}

export async function notifyUnmatchedReply(unmatchedId: string): Promise<boolean> {
  const reply = await prisma.unmatchedReply.findUnique({
    where: { id: unmatchedId },
    include: { mailbox: { select: { email: true } } },
  })
  if (!reply || reply.notifiedAt) return false

  const { subject, text } = buildReplyNotification({
    classification: 'UNMATCHED',
    confidence: null,
    leadName: reply.fromEmail,
    leadEmail: reply.fromEmail,
    company: null,
    title: null,
    campaignName: null,
    mailboxEmail: reply.mailbox.email,
    replyText: `Subject: ${reply.subject}\n\n${reply.bodyPreview}`,
    leadUrl: null,
  })

  const ok = await deliver(reply.organizationId, subject, text)
  if (ok) await prisma.unmatchedReply.update({ where: { id: unmatchedId }, data: { notifiedAt: new Date() } })
  return ok
}

export async function sendOrgAlert(organizationId: string, subject: string, text: string): Promise<boolean> {
  return deliver(organizationId, `[OutboundOS] ${subject}`, text)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/features/replies/server/notify.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/replies/server/notify*
git commit -m "feat(replies): escalation and alert emails via the tenant's shared mailbox"
```

---

### Task 10: Draft pipeline — personalize, guardrail, sample gate, auto-queue

**Files:**
- Create: `src/features/messages/server/queue-draft.ts`
- Test: `src/features/messages/server/queue-draft.test.ts`
- Create: `src/features/sequences/server/assign-mailbox.ts`
- Test: `src/features/sequences/server/assign-mailbox.test.ts`
- Modify: `src/features/sequences/types.ts:77` (`StepResult`)
- Modify: `src/features/sequences/server/run-sequence-step.ts`
- Modify: `src/features/sequences/server/run-sequence-step.test.ts`
- Modify: `src/features/drafts/server/review-draft.ts`
- Modify: `src/features/drafts/server/review-draft.test.ts`

**Interfaces:**
- Consumes:
  - `renderTemplate`, `insertPersonalization`, `PERSONALIZATION_TOKEN` (Task 3)
  - `checkGuardrails`, `GuardrailFlag` (Task 3)
  - `getAIProvider().personalize` (Task 8)
- Produces:
  - `queueApprovedDraft(tx: Prisma.TransactionClient, draft: QueueableDraft, mailboxId: string, scheduledFor?: Date)`
  - `interface QueueableDraft { id: string; organizationId: string; leadId: string; campaignId: string | null; subject: string; body: string; subjectVariantId: string | null; subjectEdited: boolean }`
  - `assignEnrollmentMailbox(organizationId: string, enrollmentId: string): Promise<string | null>`
  - `StepResult` gains `'QUEUED' | 'DEFERRED'`
  - `MAX_AI_FAILURES = 3`

- [ ] **Step 1: Write the failing `queue-draft` and `assign-mailbox` tests**

`queue-draft.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { queueApprovedDraft } from './queue-draft'

describe('queueApprovedDraft', () => {
  it('creates a QUEUED message scheduled now with a Message-ID, keeping the variant only if unedited', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' })
    const tx = { outboundMessage: { create } } as never
    const at = new Date('2026-09-23T13:00:00Z')
    await queueApprovedDraft(
      tx,
      { id: 'd1', organizationId: 'org-1', leadId: 'l1', campaignId: 'c1', subject: 'S', body: 'B', subjectVariantId: 'v1', subjectEdited: false },
      'mb-1',
      at,
    )
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1', leadId: 'l1', mailboxId: 'mb-1', draftId: 'd1', campaignId: 'c1',
        subjectVariantId: 'v1', subject: 'S', body: 'B', status: 'QUEUED', scheduledFor: at,
        messageId: expect.stringMatching(/^<.+@.+>$/),
      }),
    })
    create.mockClear()
    await queueApprovedDraft(
      tx,
      { id: 'd2', organizationId: 'org-1', leadId: 'l1', campaignId: null, subject: 'S', body: 'B', subjectVariantId: 'v1', subjectEdited: true },
      'mb-1',
    )
    expect(create.mock.calls[0][0].data.subjectVariantId).toBeUndefined()
  })
})
```

`assign-mailbox.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    mailbox: { findMany: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn(), findUnique: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { assignEnrollmentMailbox } from './assign-mailbox'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { mailbox: { findMany: Fn }; sequenceEnrollment: { updateMany: Fn; findUnique: Fn } }
beforeEach(() => vi.resetAllMocks())

describe('assignEnrollmentMailbox', () => {
  it('picks the usable mailbox with the fewest ACTIVE enrollments and sets it only if unset', async () => {
    p.mailbox.findMany.mockResolvedValue([
      { id: 'mb-a', _count: { enrollments: 5 } },
      { id: 'mb-b', _count: { enrollments: 2 } },
    ])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-b')
    expect(p.mailbox.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', isActive: true, autoPaused: false })
    expect(p.sequenceEnrollment.updateMany).toHaveBeenCalledWith({ where: { id: 'enr-1', mailboxId: null }, data: { mailboxId: 'mb-b' } })
  })
  it('returns the already-assigned mailbox if another worker won the race', async () => {
    p.mailbox.findMany.mockResolvedValue([{ id: 'mb-a', _count: { enrollments: 0 } }])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 0 })
    p.sequenceEnrollment.findUnique.mockResolvedValue({ mailboxId: 'mb-z' })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-z')
  })
  it('returns null when no mailbox is usable', async () => {
    p.mailbox.findMany.mockResolvedValue([])
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/messages/server/queue-draft.test.ts src/features/sequences/server/assign-mailbox.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement both modules**

`queue-draft.ts`:

```ts
import type { Prisma } from '@prisma/client'
import { generateMessageId } from '../threading'

export interface QueueableDraft {
  id: string
  organizationId: string
  leadId: string
  campaignId: string | null
  subject: string
  body: string
  subjectVariantId: string | null
  subjectEdited: boolean
}

/**
 * Put an APPROVED draft on the send queue. Pacing and business hours are
 * enforced by the send queue at send time, so scheduledFor is "eligible from".
 * The unique draftId on OutboundMessage makes double-queueing impossible.
 */
export async function queueApprovedDraft(
  tx: Prisma.TransactionClient,
  draft: QueueableDraft,
  mailboxId: string,
  scheduledFor: Date = new Date(),
) {
  return tx.outboundMessage.create({
    data: {
      organizationId: draft.organizationId,
      leadId: draft.leadId,
      mailboxId,
      draftId: draft.id,
      ...(draft.campaignId && { campaignId: draft.campaignId }),
      ...(draft.subjectVariantId && !draft.subjectEdited && { subjectVariantId: draft.subjectVariantId }),
      subject: draft.subject,
      body: draft.body,
      status: 'QUEUED',
      messageId: generateMessageId(),
      scheduledFor,
    },
  })
}
```

`assign-mailbox.ts`:

```ts
import { prisma } from '@/lib/db/prisma'

/**
 * Sticky, least-loaded mailbox assignment: a lead hears from ONE mailbox for
 * the whole sequence so follow-ups thread and replies land in one inbox.
 * The conditional update (mailboxId: null) makes concurrent assignment safe.
 */
export async function assignEnrollmentMailbox(organizationId: string, enrollmentId: string): Promise<string | null> {
  const mailboxes = await prisma.mailbox.findMany({
    where: { organizationId, isActive: true, autoPaused: false },
    select: { id: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
  })
  if (mailboxes.length === 0) return null

  mailboxes.sort((a, b) => a._count.enrollments - b._count.enrollments || (a.id < b.id ? -1 : 1))
  const chosen = mailboxes[0].id

  const res = await prisma.sequenceEnrollment.updateMany({
    where: { id: enrollmentId, mailboxId: null },
    data: { mailboxId: chosen },
  })
  if (res.count === 1) return chosen

  const existing = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollmentId }, select: { mailboxId: true } })
  return existing?.mailboxId ?? null
}
```

- [ ] **Step 4: Update the `runSequenceStep` test fixture, then write the new pipeline tests**

In `run-sequence-step.test.ts`:

1. Extend the prisma mock:

   ```ts
   sequenceEnrollment: { findFirst: vi.fn(), update: vi.fn() },
   draft: { findFirst: vi.fn(), create: vi.fn(), count: vi.fn() },
   ```

2. Add these mocks below the existing ones:

   ```ts
   vi.mock('./assign-mailbox', () => ({ assignEnrollmentMailbox: vi.fn() }))
   // vi.hoisted: vi.mock factories are hoisted above plain consts, so the mock
   // fn must be created in the hoisted scope too.
   const { personalize } = vi.hoisted(() => ({ personalize: vi.fn() }))
   vi.mock('@/lib/ai', () => ({ getAIProvider: () => ({ personalize }) }))
   ```

3. Import `assignEnrollmentMailbox` from `./assign-mailbox`.

4. Replace `makeEnrollment` with:

```ts
function makeEnrollment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'enroll-1',
    organizationId: 'org-1',
    sequenceId: 'seq-1',
    leadId: 'lead-1',
    currentStepNumber: 0,
    status: 'ACTIVE',
    startedAt: new Date(),
    mailboxId: null,
    failedAttempts: 0,
    sequence: {
      campaignId: 'camp-1',
      campaign: { id: 'camp-1', autoSend: false, sampleSize: 10, sampleApprovedAt: null },
      steps: [
        { id: 'step-1', stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0, personalizationPrompt: null },
        { id: 'step-2', stepNumber: 2, subject: 'Follow up', body: 'Just checking', delayDays: 3, personalizationPrompt: null },
      ],
    },
    lead: { id: 'lead-1', status: 'NEW', firstName: 'Jane', lastName: null, company: 'Acme', title: null, customFields: null },
    organization: { sendingPaused: false, guardrailBlockedPhrases: [], guardrailAllowedWords: [] },
    ...overrides,
  }
}

// tx fake capturing draft.create and outboundMessage.create
function txFake() {
  const draftCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'draft-1', ...data }))
  const messageCreate = vi.fn().mockResolvedValue({ id: 'msg-1' })
  const enrollmentUpdate = vi.fn().mockResolvedValue({})
  mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      draft: { findFirst: vi.fn().mockResolvedValue(null), create: draftCreate, groupBy: vi.fn().mockResolvedValue([]) },
      sequenceStep: { findUnique: vi.fn().mockResolvedValue({ winningVariantId: null, winningVariant: null, subjectVariants: [] }) },
      sequenceEnrollment: { update: enrollmentUpdate },
      outboundMessage: { create: messageCreate },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    }),
  )
  return { draftCreate, messageCreate, enrollmentUpdate }
}

const autoCampaign = (sampleApprovedAt: Date | null) => ({
  campaignId: 'camp-1',
  campaign: { id: 'camp-1', autoSend: true, sampleSize: 2, sampleApprovedAt },
  steps: [{ id: 'step-1', stepNumber: 1, subject: 'Snow plan for {company}', body: 'Hi {firstName|there},\n\n{personalization}\n\nWe plow lots.', delayDays: 0, personalizationPrompt: 'Mention their company.' }],
})
```

Append these tests:

```ts
describe('runSequenceStep — auto-send pipeline', () => {
  beforeEach(() => {
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    ;(assignEnrollmentMailbox as ReturnType<typeof vi.fn>).mockResolvedValue('mb-1')
    personalize.mockResolvedValue('Saw Acme runs several plazas.')
  })

  it('manual campaign: renders merge fields into a PENDING_REVIEW draft, no queueing', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({
      sequence: { ...makeEnrollment().sequence, steps: [{ id: 'step-1', stepNumber: 1, subject: 'Hi {firstName}', body: 'For {company}', delayDays: 0, personalizationPrompt: null }] },
    }))
    const { draftCreate, messageCreate } = txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DRAFT_GENERATED')
    expect(draftCreate.mock.calls[0][0].data).toMatchObject({ subject: 'Hi Jane', body: 'For Acme', status: 'PENDING_REVIEW', isSample: false })
    expect(messageCreate).not.toHaveBeenCalled()
    expect(personalize).not.toHaveBeenCalled()
  })

  it('auto-send before sample approval: personalized sample draft, mailbox assigned, not queued', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(null) }))
    ;(prisma.draft.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)
    const { draftCreate, messageCreate } = txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DRAFT_GENERATED')
    expect(draftCreate.mock.calls[0][0].data).toMatchObject({
      subject: 'Snow plan for Acme',
      body: 'Hi Jane,\n\nSaw Acme runs several plazas.\n\nWe plow lots.',
      status: 'PENDING_REVIEW',
      isSample: true,
    })
    expect(messageCreate).not.toHaveBeenCalled()
  })

  it('auto-send with a full sample batch: defers without generating or calling AI', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(null) }))
    ;(prisma.draft.count as ReturnType<typeof vi.fn>).mockResolvedValue(2)
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
    expect(personalize).not.toHaveBeenCalled()
    expect(prisma.sequenceEnrollment.update).toHaveBeenCalledWith({ where: { id: 'enroll-1' }, data: { nextDueAt: expect.any(Date) } })
  })

  it('auto-send after sample approval: APPROVED draft queued on the assigned mailbox', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(new Date()) }))
    const { draftCreate, messageCreate } = txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('QUEUED')
    expect(draftCreate.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', isSample: false })
    expect(messageCreate.mock.calls[0][0].data).toMatchObject({ mailboxId: 'mb-1', status: 'QUEUED', draftId: 'draft-1' })
  })

  it('missing first name with no fallback → BLOCKED, never queued (Review Focus #2)', async () => {
    const seq = autoCampaign(new Date())
    seq.steps[0].body = 'Hi {firstName},\n\n{personalization}'
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: seq, lead: { ...makeEnrollment().lead, firstName: null } }))
    const { draftCreate, messageCreate } = txFake()
    await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(draftCreate.mock.calls[0][0].data.status).toBe('BLOCKED')
    expect(draftCreate.mock.calls[0][0].data.guardrailFlags).toContainEqual({ rule: 'UNFILLED_TOKEN', match: '{firstName}' })
    expect(messageCreate).not.toHaveBeenCalled()
  })

  it('AI failure below the limit: defers and counts the failure', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(new Date()), failedAttempts: 0 }))
    personalize.mockRejectedValue(new Error('timeout'))
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
    expect(prisma.sequenceEnrollment.update).toHaveBeenCalledWith({
      where: { id: 'enroll-1' },
      data: { failedAttempts: 1, nextDueAt: expect.any(Date) },
    })
  })

  it('AI failure at the limit: BLOCKED draft flagged AI_FAILED', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(new Date()), failedAttempts: 2 }))
    personalize.mockRejectedValue(new Error('timeout'))
    const { draftCreate } = txFake()
    await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(draftCreate.mock.calls[0][0].data.status).toBe('BLOCKED')
    expect(draftCreate.mock.calls[0][0].data.guardrailFlags[0].rule).toBe('AI_FAILED')
  })

  it('org sending paused: auto-send campaign defers', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({
      sequence: autoCampaign(new Date()),
      organization: { sendingPaused: true, guardrailBlockedPhrases: [], guardrailAllowedWords: [] },
    }))
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
  })

  it('no usable mailbox: defers', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ sequence: autoCampaign(new Date()) }))
    ;(assignEnrollmentMailbox as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
  })
})
```

- [ ] **Step 5: Run to verify the new tests fail**

Run: `npx vitest run src/features/sequences/server/run-sequence-step.test.ts`
Expected: the new pipeline tests FAIL. The existing tests may also fail until
Step 6.

- [ ] **Step 6: Implement the pipeline**

In `src/features/sequences/types.ts`, replace line 77:

```ts
export type StepResult = 'DRAFT_GENERATED' | 'QUEUED' | 'DEFERRED' | 'COMPLETED' | 'STOPPED' | 'SKIPPED' | 'ERROR'
```

Replace `src/features/sequences/server/run-sequence-step.ts` with:

```ts
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { checkEnrollmentStop } from './check-enrollment-stop'
import { selectSubjectVariant } from './select-subject-variant'
import { assignEnrollmentMailbox } from './assign-mailbox'
import { renderTemplate, insertPersonalization, PERSONALIZATION_TOKEN } from '../render-template'
import { checkGuardrails, type GuardrailFlag } from '@/features/drafts/guardrails'
import { queueApprovedDraft } from '@/features/messages/server/queue-draft'
import type { StepResult } from '../types'

interface RunStepInput {
  enrollmentId: string
}

export const MAX_AI_FAILURES = 3
const DEFER_MS = 60 * 60 * 1000 // gate not open yet (sample pending, paused, no mailbox)
const AI_RETRY_MS = 15 * 60 * 1000

async function defer(enrollmentId: string, ms = DEFER_MS): Promise<'DEFERRED'> {
  // Pushing nextDueAt keeps deferred enrollments from starving the runner's
  // oldest-first batch.
  await prisma.sequenceEnrollment.update({
    where: { id: enrollmentId },
    data: { nextDueAt: new Date(Date.now() + ms) },
  })
  return 'DEFERRED'
}

export async function runSequenceStep({ enrollmentId }: RunStepInput): Promise<StepResult> {
  // 1. Fetch enrollment with sequence, steps, campaign, lead and org settings
  const enrollment = await prisma.sequenceEnrollment.findFirst({
    where: { id: enrollmentId },
    include: {
      sequence: {
        include: {
          steps: { orderBy: { stepNumber: 'asc' } },
          campaign: { select: { id: true, autoSend: true, sampleSize: true, sampleApprovedAt: true } },
        },
      },
      lead: {
        select: { id: true, status: true, firstName: true, lastName: true, company: true, title: true, customFields: true },
      },
      organization: {
        select: { sendingPaused: true, guardrailBlockedPhrases: true, guardrailAllowedWords: true },
      },
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
    await prisma.$transaction(async (tx) => {
      await tx.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'COMPLETED', nextDueAt: null },
      })
    })
    return 'COMPLETED'
  }

  const campaign = enrollment.sequence.campaign
  const org = enrollment.organization
  const lead = enrollment.lead

  // 4. Auto-send gates — checked BEFORE any AI spend.
  let mailboxId = enrollment.mailboxId
  if (campaign.autoSend) {
    if (org.sendingPaused) return defer(enrollmentId)
    if (!campaign.sampleApprovedAt) {
      const samples = await prisma.draft.count({ where: { campaignId: campaign.id, isSample: true } })
      if (samples >= campaign.sampleSize) return defer(enrollmentId)
    }
    if (!mailboxId) {
      mailboxId = await assignEnrollmentMailbox(enrollment.organizationId, enrollmentId)
      if (!mailboxId) return defer(enrollmentId)
    }
  }

  // 5. AI personalization — outside any transaction.
  let personalization: string | null = null
  let aiFailed = false
  if (nextStep.personalizationPrompt && nextStep.body.includes(PERSONALIZATION_TOKEN)) {
    try {
      personalization = await getAIProvider().personalize(
        { firstName: lead.firstName, lastName: lead.lastName, company: lead.company, title: lead.title, customFields: lead.customFields },
        nextStep.personalizationPrompt,
      )
    } catch (err) {
      const failures = enrollment.failedAttempts + 1
      console.error(`[runSequenceStep] personalization failed for ${enrollmentId} (attempt ${failures})`, err)
      if (failures < MAX_AI_FAILURES) {
        await prisma.sequenceEnrollment.update({
          where: { id: enrollmentId },
          data: { failedAttempts: failures, nextDueAt: new Date(Date.now() + AI_RETRY_MS) },
        })
        return 'DEFERRED'
      }
      aiFailed = true
    }
  }

  // 6. Create the draft (and queue it if auto-approved) atomically.
  const result = await prisma.$transaction(async (tx) => {
    const followingStep = enrollment.sequence.steps.find((s) => s.stepNumber === nextStepNumber + 1)
    const advance = {
      currentStepNumber: nextStepNumber,
      failedAttempts: 0,
      nextDueAt: followingStep ? new Date(Date.now() + followingStep.delayDays * 24 * 60 * 60 * 1000) : null,
    }

    // Idempotency: check if draft already exists for this step
    const existingDraft = await tx.draft.findFirst({
      where: { sequenceId: enrollment.sequenceId, leadId: enrollment.leadId, sequenceStepId: nextStep.id },
      select: { id: true },
    })
    if (existingDraft) {
      await tx.sequenceEnrollment.update({ where: { id: enrollmentId }, data: advance })
      return 'SKIPPED' as const
    }

    // Subject-line A/B test: ONLY the first step is tested (follow-ups thread as
    // "Re: <root>").
    let subjectTemplate = nextStep.subject
    let subjectVariantId: string | null = null
    if (nextStep.stepNumber === 1) {
      const variant = await selectSubjectVariant(tx, nextStep.id)
      if (variant) {
        subjectTemplate = variant.subject
        subjectVariantId = variant.variantId
      }
    }

    const subject = renderTemplate(subjectTemplate, lead)
    const body = renderTemplate(insertPersonalization(nextStep.body, personalization), lead)
    const flags: GuardrailFlag[] = checkGuardrails({
      subject,
      body,
      personalization,
      templateText: `${subjectTemplate}\n${nextStep.body}`,
      blockedPhrases: org.guardrailBlockedPhrases,
      allowedWords: org.guardrailAllowedWords,
    })
    if (aiFailed) flags.unshift({ rule: 'AI_FAILED', match: `personalization failed ${MAX_AI_FAILURES} times` })

    const blocked = flags.length > 0
    const autoApprove = campaign.autoSend && !!campaign.sampleApprovedAt && !blocked
    const isSample = campaign.autoSend && !campaign.sampleApprovedAt && !blocked
    const status = blocked ? 'BLOCKED' : autoApprove ? 'APPROVED' : 'PENDING_REVIEW'

    const draft = await tx.draft.create({
      data: {
        organizationId: enrollment.organizationId,
        leadId: enrollment.leadId,
        campaignId: enrollment.sequence.campaignId,
        sequenceId: enrollment.sequenceId,
        sequenceStepId: nextStep.id,
        sequenceEnrollmentId: enrollment.id,
        subject,
        body,
        status,
        isSample,
        ...(blocked && { guardrailFlags: flags as unknown as Prisma.InputJsonValue }),
        ...(autoApprove && { approvedAt: new Date() }),
        ...(subjectVariantId && { subjectVariantId }),
      },
    })

    if (autoApprove && mailboxId) {
      await queueApprovedDraft(
        tx,
        { ...draft, campaignId: draft.campaignId ?? null, subjectVariantId: draft.subjectVariantId ?? null, subjectEdited: false },
        mailboxId,
      )
    }

    await tx.sequenceEnrollment.update({ where: { id: enrollmentId }, data: advance })

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
          draftStatus: status,
        },
      },
    })

    return autoApprove ? ('QUEUED' as const) : ('DRAFT_GENERATED' as const)
  })

  return result
}
```

- [ ] **Step 7: Let `reviewDraft` handle `BLOCKED` drafts and auto-queue approvals**

In `src/features/drafts/server/review-draft.ts`:

1. In both the approve and reject `updateMany` calls, change
   `status: 'PENDING_REVIEW'` to `status: { in: ['PENDING_REVIEW', 'BLOCKED'] }`.
2. Add `import { queueApprovedDraft } from '@/features/messages/server/queue-draft'`.
3. Right after the approve branch's `if (result.count === 0) { … }`, add:

```ts
      // Auto-send campaigns: once the sample is approved, any human-approved
      // draft (e.g. a fixed BLOCKED one) goes straight onto the send queue.
      if (existing.campaignId && existing.sequenceEnrollmentId) {
        const [campaign, enrollment] = await Promise.all([
          tx.campaign.findUnique({ where: { id: existing.campaignId }, select: { autoSend: true, sampleApprovedAt: true } }),
          tx.sequenceEnrollment.findUnique({ where: { id: existing.sequenceEnrollmentId }, select: { mailboxId: true } }),
        ])
        if (campaign?.autoSend && campaign.sampleApprovedAt && enrollment?.mailboxId) {
          const approved = await tx.draft.findUniqueOrThrow({ where: { id: draftId } })
          await queueApprovedDraft(tx, approved, enrollment.mailboxId)
        }
      }
```

Append to `review-draft.test.ts`, inside `describe('reviewDraft', …)`:

```ts
  function autoSendTx(campaign: { autoSend: boolean; sampleApprovedAt: Date | null }) {
    const blocked = {
      ...pendingDraft,
      status: 'BLOCKED',
      campaignId: 'c1',
      sequenceEnrollmentId: 'e1',
      subjectVariantId: null,
      subjectEdited: false,
    }
    const approvedRow = { ...blocked, status: 'APPROVED', approvedByClerkId: 'user-1', approvedAt: new Date() }
    const messageCreate = vi.fn().mockResolvedValue({ id: 'msg-1' })
    const draftUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    mockPrisma.draft.findFirst.mockResolvedValue(blocked)
    mockPrisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        draft: {
          updateMany: draftUpdateMany,
          findUnique: vi.fn().mockResolvedValue(approvedRow),
          findUniqueOrThrow: vi.fn().mockResolvedValue(approvedRow),
        },
        campaign: { findUnique: vi.fn().mockResolvedValue(campaign) },
        sequenceEnrollment: { findUnique: vi.fn().mockResolvedValue({ mailboxId: 'mb-1' }) },
        outboundMessage: { create: messageCreate },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }),
    )
    return { messageCreate, draftUpdateMany }
  }

  it('approving a BLOCKED draft on an auto-send campaign with approved sample queues it', async () => {
    const { messageCreate, draftUpdateMany } = autoSendTx({ autoSend: true, sampleApprovedAt: new Date() })
    const result = await reviewDraft(approveInput)
    expect(result.status).toBe('APPROVED')
    expect(draftUpdateMany.mock.calls[0][0].where.status).toEqual({ in: ['PENDING_REVIEW', 'BLOCKED'] })
    expect(messageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ draftId: 'draft-1', mailboxId: 'mb-1', status: 'QUEUED', leadId: 'lead-1' }),
    })
  })

  it('approving a draft on a manual campaign does not queue it', async () => {
    const { messageCreate } = autoSendTx({ autoSend: false, sampleApprovedAt: null })
    await reviewDraft(approveInput)
    expect(messageCreate).not.toHaveBeenCalled()
  })

  it('approving on an auto-send campaign whose sample is not yet approved does not queue it', async () => {
    const { messageCreate } = autoSendTx({ autoSend: true, sampleApprovedAt: null })
    await reviewDraft(approveInput)
    expect(messageCreate).not.toHaveBeenCalled()
  })
```

The existing fixtures have no `campaignId`/`sequenceEnrollmentId`, so the new
branch is skipped and the pre-existing tests are unaffected.

- [ ] **Step 8: Run the tests and typecheck**

Run: `npx vitest run src/features/sequences src/features/drafts src/features/messages && npx tsc --noEmit`
Expected: PASS, including all pre-existing tests.

- [ ] **Step 9: Commit**

```bash
git add src/features/sequences src/features/drafts src/features/messages/server/queue-draft*
git commit -m "feat(sequences): personalize, guardrail, sample-gate and auto-queue sequence drafts"
```

---

### Task 11: Campaign creation, auto-send settings, and sample approval

**Files:**
- Create: `src/features/campaigns/server/campaign-sending.ts`
- Test: `src/features/campaigns/server/campaign-sending.test.ts`
- Create: `src/app/api/campaigns/route.ts`
- Create: `src/app/api/campaigns/[id]/route.ts`
- Create: `src/app/api/campaigns/[id]/approve-sample/route.ts`
- Test: `src/app/api/campaigns/[id]/approve-sample/route.test.ts`

**Interfaces:**
- Consumes: `queueApprovedDraft` (Task 10).
- Produces:
  - `createCampaign({ organizationId, name, description? }): Promise<{ id: string; name: string }>`
  - `updateCampaignSending({ organizationId, campaignId, autoSend?, sampleSize? }): Promise<{ id: string; autoSend: boolean; sampleSize: number; sampleApprovedAt: Date | null }>`
  - `approveCampaignSample({ organizationId, campaignId, clerkUserId }): Promise<{ queued: number }>`
  - `class CampaignNotFoundError extends Error`

- [ ] **Step 1: Write the failing server tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { campaign: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }, $transaction: vi.fn() },
}))

import { prisma } from '@/lib/db/prisma'
import { approveCampaignSample, updateCampaignSending, createCampaign, CampaignNotFoundError } from './campaign-sending'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { campaign: { findFirst: Fn; create: Fn; update: Fn }; $transaction: Fn }
beforeEach(() => vi.resetAllMocks())

describe('approveCampaignSample', () => {
  it('approves pending sample drafts, queues every unsent sample draft, stamps sampleApprovedAt', async () => {
    p.campaign.findFirst.mockResolvedValue({ id: 'c1', autoSend: true })
    const draftUpdateMany = vi.fn().mockResolvedValue({ count: 2 })
    const sampleDrafts = [
      { id: 'd1', organizationId: 'org-1', leadId: 'l1', campaignId: 'c1', subject: 'S', body: 'B', subjectVariantId: null, subjectEdited: false, sequenceEnrollment: { mailboxId: 'mb-1' } },
      { id: 'd2', organizationId: 'org-1', leadId: 'l2', campaignId: 'c1', subject: 'S', body: 'B', subjectVariantId: null, subjectEdited: false, sequenceEnrollment: { mailboxId: 'mb-2' } },
      { id: 'd3', organizationId: 'org-1', leadId: 'l3', campaignId: 'c1', subject: 'S', body: 'B', subjectVariantId: null, subjectEdited: false, sequenceEnrollment: { mailboxId: null } },
    ]
    const messageCreate = vi.fn().mockResolvedValue({})
    const campaignUpdate = vi.fn().mockResolvedValue({})
    p.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        draft: { updateMany: draftUpdateMany, findMany: vi.fn().mockResolvedValue(sampleDrafts) },
        outboundMessage: { create: messageCreate },
        campaign: { update: campaignUpdate },
        auditLog: { create: vi.fn() },
      }),
    )

    const out = await approveCampaignSample({ organizationId: 'org-1', campaignId: 'c1', clerkUserId: 'u1' })

    expect(draftUpdateMany).toHaveBeenCalledWith({
      where: { campaignId: 'c1', organizationId: 'org-1', isSample: true, status: 'PENDING_REVIEW' },
      data: { status: 'APPROVED', approvedByClerkId: 'u1', approvedAt: expect.any(Date) },
    })
    expect(messageCreate).toHaveBeenCalledTimes(2) // d3 has no mailbox yet → skipped
    expect(campaignUpdate).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { sampleApprovedAt: expect.any(Date) } })
    expect(out).toEqual({ queued: 2 })
  })

  it('throws CampaignNotFoundError for another org', async () => {
    p.campaign.findFirst.mockResolvedValue(null)
    await expect(approveCampaignSample({ organizationId: 'org-1', campaignId: 'x', clerkUserId: 'u1' })).rejects.toBeInstanceOf(CampaignNotFoundError)
  })
})

describe('updateCampaignSending', () => {
  it('clamps sampleSize to 1..50', async () => {
    p.campaign.findFirst.mockResolvedValue({ id: 'c1' })
    p.campaign.update.mockResolvedValue({ id: 'c1', autoSend: true, sampleSize: 50, sampleApprovedAt: null })
    await updateCampaignSending({ organizationId: 'org-1', campaignId: 'c1', autoSend: true, sampleSize: 500 })
    expect(p.campaign.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { autoSend: true, sampleSize: 50 },
      select: { id: true, autoSend: true, sampleSize: true, sampleApprovedAt: true },
    })
  })
})

describe('createCampaign', () => {
  it('creates an ACTIVE campaign with a trimmed name', async () => {
    p.campaign.create.mockResolvedValue({ id: 'c9', name: 'Buffalo HOAs' })
    await createCampaign({ organizationId: 'org-1', name: '  Buffalo HOAs ' })
    expect(p.campaign.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', name: 'Buffalo HOAs', description: null, status: 'ACTIVE' },
      select: { id: true, name: true },
    })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/features/campaigns/server/campaign-sending.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `campaign-sending.ts`**

```ts
import { prisma } from '@/lib/db/prisma'
import { queueApprovedDraft } from '@/features/messages/server/queue-draft'

export class CampaignNotFoundError extends Error {
  constructor() {
    super('Campaign not found')
    this.name = 'CampaignNotFoundError'
    Object.setPrototypeOf(this, CampaignNotFoundError.prototype)
  }
}

export async function createCampaign(input: { organizationId: string; name: string; description?: string | null }) {
  return prisma.campaign.create({
    data: {
      organizationId: input.organizationId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      status: 'ACTIVE',
    },
    select: { id: true, name: true },
  })
}

export async function updateCampaignSending(input: {
  organizationId: string
  campaignId: string
  autoSend?: boolean
  sampleSize?: number
}) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, organizationId: input.organizationId },
    select: { id: true },
  })
  if (!campaign) throw new CampaignNotFoundError()

  return prisma.campaign.update({
    where: { id: campaign.id },
    data: {
      ...(input.autoSend !== undefined && { autoSend: input.autoSend }),
      ...(input.sampleSize !== undefined && { sampleSize: Math.min(50, Math.max(1, Math.round(input.sampleSize))) }),
    },
    select: { id: true, autoSend: true, sampleSize: true, sampleApprovedAt: true },
  })
}

/**
 * One click that turns the campaign loose: approve every pending sample draft,
 * queue every approved-but-unsent sample draft (including ones approved
 * individually earlier), and open the gate for all future drafts.
 */
export async function approveCampaignSample(input: {
  organizationId: string
  campaignId: string
  clerkUserId: string
}): Promise<{ queued: number }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: input.campaignId, organizationId: input.organizationId },
    select: { id: true, autoSend: true },
  })
  if (!campaign) throw new CampaignNotFoundError()

  return prisma.$transaction(async (tx) => {
    const now = new Date()
    await tx.draft.updateMany({
      where: { campaignId: campaign.id, organizationId: input.organizationId, isSample: true, status: 'PENDING_REVIEW' },
      data: { status: 'APPROVED', approvedByClerkId: input.clerkUserId, approvedAt: now },
    })

    const toQueue = await tx.draft.findMany({
      where: { campaignId: campaign.id, isSample: true, status: 'APPROVED', outboundMessages: { none: {} } },
      include: { sequenceEnrollment: { select: { mailboxId: true } } },
    })

    let queued = 0
    for (const draft of toQueue) {
      const mailboxId = draft.sequenceEnrollment?.mailboxId
      if (!mailboxId) continue
      await queueApprovedDraft(tx, draft, mailboxId, now)
      queued++
    }

    await tx.campaign.update({ where: { id: campaign.id }, data: { sampleApprovedAt: now } })
    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorClerkId: input.clerkUserId,
        action: 'campaign.sample_approved',
        entityType: 'Campaign',
        entityId: campaign.id,
        metadata: { queued },
      },
    })
    return { queued }
  })
}
```

- [ ] **Step 4: Write the routes**

The routes follow the `src/app/api/mailboxes` pattern: Clerk `auth()`, 403
with no org, `resolveOrganization`, JSON validation, and 404 on
`CampaignNotFoundError`.

`src/app/api/campaigns/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { createCampaign } from '@/features/campaigns/server/campaign-sending'

export async function POST(request: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { name?: unknown; description?: unknown } | null
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const org = await resolveOrganization(orgId)
  const campaign = await createCampaign({
    organizationId: org.id,
    name: body.name,
    description: typeof body.description === 'string' ? body.description : null,
  })
  return NextResponse.json(campaign, { status: 201 })
}
```

`src/app/api/campaigns/[id]/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { updateCampaignSending, CampaignNotFoundError } from '@/features/campaigns/server/campaign-sending'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params

  const body = (await request.json().catch(() => null)) as { autoSend?: unknown; sampleSize?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (body.autoSend !== undefined && typeof body.autoSend !== 'boolean') {
    return NextResponse.json({ error: 'autoSend must be a boolean' }, { status: 400 })
  }
  if (body.sampleSize !== undefined && (typeof body.sampleSize !== 'number' || !Number.isFinite(body.sampleSize))) {
    return NextResponse.json({ error: 'sampleSize must be a number' }, { status: 400 })
  }

  try {
    const org = await resolveOrganization(orgId)
    const updated = await updateCampaignSending({
      organizationId: org.id,
      campaignId: id,
      autoSend: body.autoSend as boolean | undefined,
      sampleSize: body.sampleSize as number | undefined,
    })
    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof CampaignNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 })
    throw err
  }
}
```

`src/app/api/campaigns/[id]/approve-sample/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { approveCampaignSample, CampaignNotFoundError } from '@/features/campaigns/server/campaign-sending'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params
  try {
    const org = await resolveOrganization(orgId)
    const result = await approveCampaignSample({ organizationId: org.id, campaignId: id, clerkUserId: userId })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof CampaignNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 })
    throw err
  }
}
```

`src/app/api/campaigns/[id]/approve-sample/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn().mockResolvedValue({ id: 'org-1' }) }))
vi.mock('@/features/campaigns/server/campaign-sending', async (orig) => ({
  ...(await orig<typeof import('@/features/campaigns/server/campaign-sending')>()),
  approveCampaignSample: vi.fn(),
}))

import { auth } from '@clerk/nextjs/server'
import { approveCampaignSample, CampaignNotFoundError } from '@/features/campaigns/server/campaign-sending'
import { POST } from './route'

const ctx = { params: Promise.resolve({ id: 'c1' }) }
beforeEach(() => vi.clearAllMocks())

describe('POST /api/campaigns/[id]/approve-sample', () => {
  it('403 without an org', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: null, userId: null })
    expect((await POST(new Request('http://x', { method: 'POST' }), ctx)).status).toBe(403)
  })
  it('returns the queued count', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    ;(approveCampaignSample as ReturnType<typeof vi.fn>).mockResolvedValue({ queued: 7 })
    const res = await POST(new Request('http://x', { method: 'POST' }), ctx)
    expect(await res.json()).toEqual({ queued: 7 })
    expect(approveCampaignSample).toHaveBeenCalledWith({ organizationId: 'org-1', campaignId: 'c1', clerkUserId: 'u1' })
  })
  it('404 for an unknown campaign', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    ;(approveCampaignSample as ReturnType<typeof vi.fn>).mockRejectedValue(new CampaignNotFoundError())
    expect((await POST(new Request('http://x', { method: 'POST' }), ctx)).status).toBe(404)
  })
})
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/campaigns src/app/api/campaigns && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/campaigns/server/campaign-sending* src/app/api/campaigns
git commit -m "feat(campaigns): create campaigns, auto-send settings, one-click sample approval"
```

---

### Task 12: Send queue and cron plumbing

**Files:**
- Create: `src/lib/cron.ts`
- Test: `src/lib/cron.test.ts`
- Create: `src/features/messages/server/process-send-queue.ts`
- Test: `src/features/messages/server/process-send-queue.test.ts`
- Create: `src/app/api/cron/send-queue/route.ts`
- Test: `src/app/api/cron/send-queue/route.test.ts`
- Modify: `src/app/api/cron/sequence-runner/route.ts`

**Interfaces:**
- Consumes:
  - `isInSendWindow`, `mailboxSpacingMs`, `nextSendAt` (Task 2)
  - `getEmailProvider`, `getMessageState`, `sendDraftMessage`, and the Graph
    error classes (Tasks 5–6)
  - `reserveMailboxSlot`, `releaseMailboxSlot`, `startOfDay` (Task 7)
  - `sendOrgAlert` (Task 9)
  - `checkEnrollmentStop`, `transitionLeadStatus`, `effectiveDailyLimit`,
    `buildReplySubject`, `signUnsubscribeToken` (existing)
- Produces:
  - `isAuthorizedCron(request: Request): boolean`
  - `recordHeartbeat(job: CronJob, result: unknown): Promise<void>`
  - `getStaleJobs(now?: Date): Promise<CronJob[]>`
  - `type CronJob = 'sequence-runner' | 'send-queue' | 'inbox-monitor'`
  - `CRON_JOBS: CronJob[]`
  - `STALE_AFTER_MS = 30 * 60 * 1000`
  - `processSendQueue(now?: Date, budgetMs?: number): Promise<SendQueueResult>`
  - `interface SendQueueResult { sent: number; cancelled: number; deferred: number; failed: number; reconciled: number }`
  - `pauseOrgSending(organizationId: string, reason: string): Promise<void>`
    (exported; Task 13 reuses it)

- [ ] **Step 1: Write the failing `cron.ts` tests**

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { cronHeartbeat: { upsert: vi.fn(), findMany: vi.fn() } } }))

import { prisma } from '@/lib/db/prisma'
import { isAuthorizedCron, recordHeartbeat, getStaleJobs } from './cron'

type Fn = ReturnType<typeof vi.fn>
const hb = prisma.cronHeartbeat as unknown as { upsert: Fn; findMany: Fn }

beforeEach(() => { vi.resetAllMocks(); process.env.CRON_SECRET = 's3cret' })
afterEach(() => { delete process.env.CRON_SECRET })

describe('cron helpers', () => {
  it('authorizes only the exact bearer secret, and never when unset', () => {
    const req = (h?: string) => new Request('http://x', { headers: h ? { authorization: h } : {} })
    expect(isAuthorizedCron(req('Bearer s3cret'))).toBe(true)
    expect(isAuthorizedCron(req('Bearer nope'))).toBe(false)
    expect(isAuthorizedCron(req())).toBe(false)
    delete process.env.CRON_SECRET
    expect(isAuthorizedCron(req('Bearer undefined'))).toBe(false)
  })
  it('upserts a heartbeat', async () => {
    await recordHeartbeat('send-queue', { sent: 1 })
    expect(hb.upsert).toHaveBeenCalledWith({
      where: { job: 'send-queue' },
      create: { job: 'send-queue', lastRunAt: expect.any(Date), lastResult: { sent: 1 } },
      update: { lastRunAt: expect.any(Date), lastResult: { sent: 1 } },
    })
  })
  it('reports missing and >30-minute-old jobs as stale', async () => {
    const now = new Date('2026-09-23T15:00:00Z')
    hb.findMany.mockResolvedValue([
      { job: 'send-queue', lastRunAt: new Date('2026-09-23T14:55:00Z') },
      { job: 'inbox-monitor', lastRunAt: new Date('2026-09-23T14:00:00Z') },
    ])
    expect(await getStaleJobs(now)).toEqual(['sequence-runner', 'inbox-monitor'])
  })
})
```

- [ ] **Step 2: Implement `src/lib/cron.ts`**

```ts
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

export type CronJob = 'sequence-runner' | 'send-queue' | 'inbox-monitor'
export const CRON_JOBS: CronJob[] = ['sequence-runner', 'send-queue', 'inbox-monitor']
export const STALE_AFTER_MS = 30 * 60 * 1000

export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function recordHeartbeat(job: CronJob, result: unknown): Promise<void> {
  const lastResult = JSON.parse(JSON.stringify(result ?? null)) as Prisma.InputJsonValue
  const lastRunAt = new Date()
  await prisma.cronHeartbeat.upsert({
    where: { job },
    create: { job, lastRunAt, lastResult },
    update: { lastRunAt, lastResult },
  })
}

/** Jobs that have never run or haven't run in STALE_AFTER_MS. */
export async function getStaleJobs(now: Date = new Date()): Promise<CronJob[]> {
  const rows = await prisma.cronHeartbeat.findMany({ where: { job: { in: CRON_JOBS } } })
  const last = new Map(rows.map((r) => [r.job, r.lastRunAt]))
  return CRON_JOBS.filter((job) => {
    const at = last.get(job)
    return !at || now.getTime() - at.getTime() > STALE_AFTER_MS
  })
}
```

Run: `npx vitest run src/lib/cron.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing send-queue tests**

The tests mock prisma per call. The helpers below build the rows
`processSendQueue` reads.

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboundMessage: { updateMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    organization: { findMany: vi.fn(), updateMany: vi.fn() },
    mailbox: { findMany: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock('@/lib/email', () => ({ getEmailProvider: vi.fn() }))
vi.mock('@/lib/email/graph/mail', () => ({ getMessageState: vi.fn(), sendDraftMessage: vi.fn() }))
vi.mock('@/features/mailboxes/server/mailbox-slots', () => ({
  startOfDay: (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()),
  reserveMailboxSlot: vi.fn(),
  releaseMailboxSlot: vi.fn(),
}))
vi.mock('@/features/sequences/server/check-enrollment-stop', () => ({ checkEnrollmentStop: vi.fn() }))
vi.mock('@/features/leads/server/transition-lead-status', () => ({ transitionLeadStatus: vi.fn() }))
vi.mock('@/features/replies/server/notify', () => ({ sendOrgAlert: vi.fn() }))
vi.mock('@/lib/email/unsubscribe-token', () => ({ signUnsubscribeToken: () => 'tok' }))

import { prisma } from '@/lib/db/prisma'
import { getEmailProvider } from '@/lib/email'
import { getMessageState, sendDraftMessage } from '@/lib/email/graph/mail'
import { reserveMailboxSlot, releaseMailboxSlot } from '@/features/mailboxes/server/mailbox-slots'
import { checkEnrollmentStop } from '@/features/sequences/server/check-enrollment-stop'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { GraphAuthError, GraphThrottledError } from '@/lib/email/graph/client'
import { processSendQueue } from './process-send-queue'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  outboundMessage: { updateMany: Fn; findMany: Fn; findFirst: Fn; update: Fn; findUnique: Fn }
  organization: { findMany: Fn; updateMany: Fn }
  mailbox: { findMany: Fn; update: Fn }
  auditLog: { create: Fn }
}
const sendEmail = vi.fn()
const NOW = new Date('2026-09-23T14:00:00Z') // Wed 10:00 EDT — inside the window

const org = {
  id: 'org-1', msTenantId: 'tenant-1', timezone: 'America/New_York',
  businessHoursStart: 8, businessHoursEnd: 17, sendDays: [1, 2, 3, 4, 5], sendingPaused: false,
}
const mailbox = {
  id: 'mb-1', organizationId: 'org-1', email: 'mike@getacmesnow.com', displayName: 'Mike',
  dailyLimit: 30, warmupEnabled: false, warmupStartedAt: new Date('2026-01-01'), nextSendAt: null,
}
const queued = (o: Record<string, unknown> = {}) => ({
  id: 'msg-1', organizationId: 'org-1', leadId: 'lead-1', mailboxId: 'mb-1', status: 'QUEUED', processing: false,
  subject: 'Snow plan', body: 'Hello', graphMessageId: null, sendAttempts: 0, draftId: 'd1',
  lead: { id: 'lead-1', email: 'jane@acmepm.com', status: 'CONTACTED' },
  draft: { sequenceEnrollmentId: 'enr-1', sequenceEnrollment: { id: 'enr-1', status: 'ACTIVE', startedAt: new Date('2026-09-01') } },
  ...o,
})

beforeEach(() => {
  vi.resetAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
  ;(getEmailProvider as Fn).mockReturnValue({ sendEmail })
  sendEmail.mockResolvedValue({ sgMessageId: null, providerMessageId: 'g1', conversationId: 'conv-1' })
  p.outboundMessage.updateMany.mockResolvedValue({ count: 1 }) // stale-lock recovery + claim
  p.organization.findMany.mockResolvedValue([org])
  p.mailbox.findMany.mockResolvedValue([mailbox])
  p.outboundMessage.findFirst.mockResolvedValue({ id: 'msg-1' })
  p.outboundMessage.findUnique.mockResolvedValue(queued())
  p.outboundMessage.findMany.mockResolvedValue([]) // no prior thread
  ;(reserveMailboxSlot as Fn).mockResolvedValue(true)
  ;(checkEnrollmentStop as Fn).mockResolvedValue({ shouldStop: false })
})

describe('processSendQueue', () => {
  it('sends one due message per ready mailbox, finalizes SENT and paces the mailbox', async () => {
    const res = await processSendQueue(NOW)
    expect(res.sent).toBe(1)
    expect(getEmailProvider).toHaveBeenCalledWith({ msTenantId: 'tenant-1' })
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ to: 'jane@acmepm.com', fromEmail: 'mike@getacmesnow.com', subject: 'Snow plan' })
    expect(p.outboundMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'msg-1' },
      data: expect.objectContaining({ status: 'SENT', graphMessageId: 'g1', conversationId: 'conv-1', processing: false }),
    }))
    const paced = p.mailbox.update.mock.calls[0][0]
    expect(paced.where).toEqual({ id: 'mb-1' })
    // 9h / 30 = 18 min, ±30% → between 12.6 and 23.4 minutes after NOW
    const delta = paced.data.nextSendAt.getTime() - NOW.getTime()
    expect(delta).toBeGreaterThanOrEqual(12.6 * 60_000)
    expect(delta).toBeLessThanOrEqual(23.4 * 60_000)
  })

  it('does nothing outside business hours', async () => {
    const res = await processSendQueue(new Date('2026-09-26T15:00:00Z')) // Saturday
    expect(res.sent).toBe(0)
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('cancels a queued follow-up when the lead replied since queueing (Review Focus #1)', async () => {
    ;(checkEnrollmentStop as Fn).mockResolvedValue({ shouldStop: true, reason: 'reply_received' })
    const res = await processSendQueue(NOW)
    expect(res.cancelled).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(p.outboundMessage.update).toHaveBeenCalledWith({
      where: { id: 'msg-1' },
      data: { status: 'CANCELLED', processing: false, lastError: 'reply_received' },
    })
  })

  it('crash recovery: graphMessageId already in Sent Items → mark SENT without resending (Review Focus #3)', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(queued({ graphMessageId: 'g-prev' }))
    ;(getMessageState as Fn).mockResolvedValue({ state: 'SENT', conversationId: 'conv-9' })
    const res = await processSendQueue(NOW)
    expect(res.reconciled).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(sendDraftMessage).not.toHaveBeenCalled()
    expect(p.outboundMessage.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'SENT', conversationId: 'conv-9' }),
    }))
  })

  it('crash recovery: graphMessageId still a draft → sends that draft, no new message', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(queued({ graphMessageId: 'g-prev' }))
    ;(getMessageState as Fn).mockResolvedValue({ state: 'DRAFT', conversationId: 'conv-9' })
    await processSendQueue(NOW)
    expect(sendDraftMessage).toHaveBeenCalledWith('tenant-1', 'mike@getacmesnow.com', 'g-prev')
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('mailbox at capacity: leaves the message queued and pushes the mailbox out', async () => {
    ;(reserveMailboxSlot as Fn).mockResolvedValue(false)
    const res = await processSendQueue(NOW)
    expect(res.deferred).toBe(1)
    expect(sendEmail).not.toHaveBeenCalled()
    expect(p.outboundMessage.update).toHaveBeenCalledWith({ where: { id: 'msg-1' }, data: { processing: false } })
  })

  it('throttled: releases the slot and reschedules by Retry-After', async () => {
    sendEmail.mockRejectedValue(new GraphThrottledError('slow', 429, 120))
    const res = await processSendQueue(NOW)
    expect(res.deferred).toBe(1)
    expect(releaseMailboxSlot).toHaveBeenCalledWith('mb-1')
    const upd = p.outboundMessage.update.mock.calls.at(-1)![0]
    expect(upd.data.scheduledFor.getTime()).toBe(NOW.getTime() + 120_000)
    expect(upd.data.processing).toBe(false)
  })

  it('auth failure: pauses the org and alerts once', async () => {
    sendEmail.mockRejectedValue(new GraphAuthError('denied', 403))
    p.organization.updateMany.mockResolvedValue({ count: 1 })
    await processSendQueue(NOW)
    expect(p.organization.updateMany).toHaveBeenCalledWith({
      where: { id: 'org-1', sendingPaused: false },
      data: { sendingPaused: true, pausedReason: expect.stringContaining('Microsoft 365') },
    })
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
  })

  it('third generic failure marks the message FAILED', async () => {
    p.outboundMessage.findUnique.mockResolvedValue(queued({ sendAttempts: 2 }))
    sendEmail.mockRejectedValue(new Error('500 from Graph'))
    const res = await processSendQueue(NOW)
    expect(res.failed).toBe(1)
    expect(p.outboundMessage.update.mock.calls.at(-1)![0].data).toMatchObject({ status: 'FAILED', sendAttempts: 3 })
  })

  it('threads a follow-up onto the most recent prior Graph message with "Re: <root>"', async () => {
    p.outboundMessage.findMany.mockResolvedValue([
      { subject: 'Snow plan for Acme', graphMessageId: 'g-root' },
    ])
    p.outboundMessage.findUnique.mockResolvedValue(queued({ subject: 'Following up' }))
    await processSendQueue(NOW)
    expect(sendEmail.mock.calls[0][0]).toMatchObject({ subject: 'Re: Snow plan for Acme', replyToProviderMessageId: 'g-root' })
  })
})
```

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run src/features/messages/server/process-send-queue.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 5: Implement `process-send-queue.ts`**

```ts
import { prisma } from '@/lib/db/prisma'
import { getEmailProvider } from '@/lib/email'
import { getMessageState, sendDraftMessage } from '@/lib/email/graph/mail'
import { GraphAuthError, GraphThrottledError } from '@/lib/email/graph/client'
import { signUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import { startOfDay, reserveMailboxSlot, releaseMailboxSlot } from '@/features/mailboxes/server/mailbox-slots'
import { effectiveDailyLimit } from '@/features/mailboxes/warmup'
import { checkEnrollmentStop } from '@/features/sequences/server/check-enrollment-stop'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { TERMINAL_STATUSES } from '@/features/leads/types'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { isInSendWindow, mailboxSpacingMs, nextSendAt } from '../send-window'
import { buildReplySubject } from '../threading'

export interface SendQueueResult {
  sent: number
  cancelled: number
  deferred: number
  failed: number
  reconciled: number
}

const MAX_SENDS_PER_TICK = 25
const MAX_SEND_ATTEMPTS = 3
const STALE_LOCK_MS = 10 * 60 * 1000
const CAPACITY_BACKOFF_MS = 60 * 60 * 1000

type Outcome = keyof SendQueueResult | 'skipped'

export async function pauseOrgSending(organizationId: string, reason: string): Promise<void> {
  const res = await prisma.organization.updateMany({
    where: { id: organizationId, sendingPaused: false },
    data: { sendingPaused: true, pausedReason: reason },
  })
  // Only the transition to paused alerts, so a burst of auth errors sends one email.
  if (res.count === 1) {
    await sendOrgAlert(
      organizationId,
      'Sending paused',
      `${reason}\n\nNothing will send until this is fixed and sending is resumed in Settings.`,
    )
  }
}

export async function processSendQueue(now: Date = new Date(), budgetMs = 45_000): Promise<SendQueueResult> {
  const startedAt = Date.now()
  const result: SendQueueResult = { sent: 0, cancelled: 0, deferred: 0, failed: 0, reconciled: 0 }

  // Recover claims abandoned by a crashed invocation.
  await prisma.outboundMessage.updateMany({
    where: { processing: true, processingStartedAt: { lt: new Date(now.getTime() - STALE_LOCK_MS) } },
    data: { processing: false, processingStartedAt: null },
  })

  const orgs = await prisma.organization.findMany({
    where: {
      sendingPaused: false,
      outboundMessages: { some: { status: 'QUEUED', scheduledFor: { lte: now } } },
    },
    select: {
      id: true, msTenantId: true, timezone: true, businessHoursStart: true,
      businessHoursEnd: true, sendDays: true, sendingPaused: true,
    },
  })

  let total = 0
  for (const org of orgs) {
    if (!isInSendWindow(now, org)) continue

    const mailboxes = await prisma.mailbox.findMany({
      where: {
        organizationId: org.id,
        isActive: true,
        autoPaused: false,
        OR: [{ nextSendAt: null }, { nextSendAt: { lte: now } }],
      },
    })

    for (const mailbox of mailboxes) {
      if (total >= MAX_SENDS_PER_TICK || Date.now() - startedAt > budgetMs) return result

      const next = await prisma.outboundMessage.findFirst({
        where: { mailboxId: mailbox.id, status: 'QUEUED', processing: false, scheduledFor: { lte: now } },
        orderBy: { scheduledFor: 'asc' },
        select: { id: true },
      })
      if (!next) continue

      const outcome = await sendOne(next.id, mailbox, org, now)
      if (outcome !== 'skipped') result[outcome]++
      total++
      if (outcome === 'failed' && (await isOrgPaused(org.id))) break
    }
  }
  return result
}

async function isOrgPaused(organizationId: string): Promise<boolean> {
  const orgs = await prisma.organization.findMany({ where: { id: organizationId, sendingPaused: true }, select: { id: true } })
  return orgs.length > 0
}

type MailboxRow = Awaited<ReturnType<typeof prisma.mailbox.findMany>>[number]
interface OrgRow {
  id: string
  msTenantId: string | null
  timezone: string
  businessHoursStart: number
  businessHoursEnd: number
  sendDays: number[]
}

async function sendOne(messageId: string, mailbox: MailboxRow, org: OrgRow, now: Date): Promise<Outcome> {
  // Atomic claim.
  const claimed = await prisma.outboundMessage.updateMany({
    where: { id: messageId, status: 'QUEUED', processing: false },
    data: { processing: true, processingStartedAt: now },
  })
  if (claimed.count === 0) return 'skipped'

  const message = await prisma.outboundMessage.findUnique({
    where: { id: messageId },
    include: {
      lead: { select: { id: true, email: true, status: true } },
      draft: {
        select: {
          sequenceEnrollmentId: true,
          sequenceEnrollment: { select: { id: true, status: true, startedAt: true } },
        },
      },
    },
  })
  if (!message) return 'skipped'

  // Last-moment safety: never email someone who replied, bounced or unsubscribed.
  const enrollment = message.draft?.sequenceEnrollment
  let cancelReason: string | null = null
  if (TERMINAL_STATUSES.includes(message.lead.status)) cancelReason = `lead_${message.lead.status.toLowerCase()}`
  else if (enrollment && enrollment.status === 'STOPPED') cancelReason = 'enrollment_stopped'
  else if (enrollment) {
    const stop = await checkEnrollmentStop({
      enrollment: { startedAt: enrollment.startedAt, leadId: message.leadId, organizationId: message.organizationId },
      leadStatus: message.lead.status,
    })
    if (stop.shouldStop) cancelReason = stop.reason ?? 'stopped'
  }
  if (cancelReason) {
    await prisma.outboundMessage.update({
      where: { id: messageId },
      data: { status: 'CANCELLED', processing: false, lastError: cancelReason },
    })
    return 'cancelled'
  }

  const limitToday = effectiveDailyLimit(mailbox, now)
  const paceMailbox = () =>
    prisma.mailbox.update({
      where: { id: mailbox.id },
      data: { nextSendAt: nextSendAt(now, mailboxSpacingMs(org, limitToday)) },
    })

  // Crash recovery: a previous attempt already created (and maybe sent) a Graph message.
  if (message.graphMessageId && org.msTenantId) {
    const state = await getMessageState(org.msTenantId, mailbox.email, message.graphMessageId)
    if (state.state === 'SENT') {
      await finalizeSent(messageId, message.leadId, message.organizationId, {
        graphMessageId: message.graphMessageId,
        conversationId: state.conversationId,
        subject: message.subject,
        sendAttempts: message.sendAttempts + 1,
      })
      await paceMailbox()
      return 'reconciled'
    }
    if (state.state === 'DRAFT') {
      if (!(await reserveMailboxSlot(mailbox.id, limitToday, startOfDay(now)))) {
        return deferForCapacity(messageId, mailbox.id, now)
      }
      try {
        await sendDraftMessage(org.msTenantId, mailbox.email, message.graphMessageId)
      } catch (err) {
        await releaseMailboxSlot(mailbox.id)
        return handleSendError(err, messageId, message.sendAttempts, mailbox.id, org.id, now)
      }
      await finalizeSent(messageId, message.leadId, message.organizationId, {
        graphMessageId: message.graphMessageId,
        conversationId: state.conversationId,
        subject: message.subject,
        sendAttempts: message.sendAttempts + 1,
      })
      await paceMailbox()
      return 'sent'
    }
    // MISSING: the draft was deleted; fall through and send fresh.
  }

  if (!(await reserveMailboxSlot(mailbox.id, limitToday, startOfDay(now)))) {
    return deferForCapacity(messageId, mailbox.id, now)
  }

  // Threading: follow-ups reply to the most recent message we sent in this enrollment.
  const prior = message.draft?.sequenceEnrollmentId
    ? await prisma.outboundMessage.findMany({
        where: {
          organizationId: message.organizationId,
          status: 'SENT',
          id: { not: messageId },
          draft: { sequenceEnrollmentId: message.draft.sequenceEnrollmentId },
        },
        orderBy: { sentAt: 'asc' },
        select: { subject: true, graphMessageId: true },
      })
    : []
  const root = prior[0]
  const subject = root ? buildReplySubject(root.subject) : message.subject
  const replyToProviderMessageId = [...prior].reverse().find((m) => m.graphMessageId)?.graphMessageId ?? undefined

  const token = signUnsubscribeToken({ leadId: message.leadId, organizationId: message.organizationId })
  const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/unsubscribe?token=${token}`

  let sent: { providerMessageId?: string | null; conversationId?: string | null }
  try {
    sent = await getEmailProvider({ msTenantId: org.msTenantId }).sendEmail({
      to: message.lead.email,
      fromEmail: mailbox.email,
      fromName: mailbox.displayName,
      subject,
      body: message.body,
      listUnsubscribe: { url: unsubscribeUrl },
      ...(message.messageId && { messageId: message.messageId }),
      ...(replyToProviderMessageId && { replyToProviderMessageId }),
      customArgs: { outboundMessageId: messageId, leadId: message.leadId },
      onPrepared: async (providerMessageId) => {
        await prisma.outboundMessage.update({ where: { id: messageId }, data: { graphMessageId: providerMessageId } })
      },
    })
  } catch (err) {
    await releaseMailboxSlot(mailbox.id)
    return handleSendError(err, messageId, message.sendAttempts, mailbox.id, org.id, now)
  }

  await finalizeSent(messageId, message.leadId, message.organizationId, {
    graphMessageId: sent.providerMessageId ?? null,
    conversationId: sent.conversationId ?? null,
    subject,
    sendAttempts: message.sendAttempts + 1,
  })
  await paceMailbox()
  return 'sent'
}

async function finalizeSent(
  messageId: string,
  leadId: string,
  organizationId: string,
  f: { graphMessageId: string | null; conversationId: string | null; subject: string; sendAttempts: number },
): Promise<void> {
  await prisma.outboundMessage.update({
    where: { id: messageId },
    data: {
      status: 'SENT',
      sentAt: new Date(),
      subject: f.subject,
      sendAttempts: f.sendAttempts,
      processing: false,
      processingStartedAt: null,
      lastError: null,
      ...(f.graphMessageId && { graphMessageId: f.graphMessageId }),
      ...(f.conversationId && { conversationId: f.conversationId }),
    },
  })
  await prisma.auditLog.create({
    data: { organizationId, action: 'message.sent', entityType: 'OutboundMessage', entityId: messageId, metadata: { leadId, auto: true } },
  })
  await transitionLeadStatus({
    organizationId,
    leadId,
    newStatus: 'CONTACTED',
    trigger: 'auto:message_sent',
    metadata: { messageId },
  })
}

async function deferForCapacity(messageId: string, mailboxId: string, now: Date): Promise<Outcome> {
  await prisma.outboundMessage.update({ where: { id: messageId }, data: { processing: false } })
  await prisma.mailbox.update({ where: { id: mailboxId }, data: { nextSendAt: new Date(now.getTime() + CAPACITY_BACKOFF_MS) } })
  return 'deferred'
}

async function handleSendError(
  err: unknown,
  messageId: string,
  attempts: number,
  mailboxId: string,
  organizationId: string,
  now: Date,
): Promise<Outcome> {
  if (err instanceof GraphThrottledError) {
    const until = new Date(now.getTime() + err.retryAfterSeconds * 1000)
    await prisma.outboundMessage.update({
      where: { id: messageId },
      data: { processing: false, scheduledFor: until, lastError: `throttled: ${err.message}` },
    })
    await prisma.mailbox.update({ where: { id: mailboxId }, data: { nextSendAt: until } })
    return 'deferred'
  }

  if (err instanceof GraphAuthError) {
    await prisma.outboundMessage.update({
      where: { id: messageId },
      data: { processing: false, lastError: `auth: ${err.message}` },
    })
    await pauseOrgSending(
      organizationId,
      `Microsoft 365 rejected OutboundOS (HTTP ${err.status}: ${err.message}). Check the app registration's admin consent, client secret expiry, and the Sending Mailboxes access policy.`,
    )
    return 'failed'
  }

  const nextAttempts = attempts + 1
  const message = err instanceof Error ? err.message : String(err)
  await prisma.outboundMessage.update({
    where: { id: messageId },
    data: {
      processing: false,
      sendAttempts: nextAttempts,
      lastError: message.slice(0, 500),
      ...(nextAttempts >= MAX_SEND_ATTEMPTS && { status: 'FAILED' }),
    },
  })
  console.error(`[send-queue] message ${messageId} attempt ${nextAttempts} failed:`, err)
  return nextAttempts >= MAX_SEND_ATTEMPTS ? 'failed' : 'deferred'
}
```

- [ ] **Step 6: Write the cron route and its test**

`src/app/api/cron/send-queue/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
import { processSendQueue } from '@/features/messages/server/process-send-queue'

export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await processSendQueue()
  await recordHeartbeat('send-queue', result)
  return NextResponse.json(result)
}
```

`src/app/api/cron/send-queue/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cron', () => ({ isAuthorizedCron: vi.fn(), recordHeartbeat: vi.fn() }))
vi.mock('@/features/messages/server/process-send-queue', () => ({ processSendQueue: vi.fn() }))

import { isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
import { processSendQueue } from '@/features/messages/server/process-send-queue'
import { GET } from './route'

beforeEach(() => vi.resetAllMocks())

describe('GET /api/cron/send-queue', () => {
  it('401 without the cron secret', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(false)
    expect((await GET(new Request('http://x'))).status).toBe(401)
    expect(processSendQueue).not.toHaveBeenCalled()
  })
  it('runs the queue and records a heartbeat', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(processSendQueue as ReturnType<typeof vi.fn>).mockResolvedValue({ sent: 2, cancelled: 0, deferred: 0, failed: 0, reconciled: 0 })
    const res = await GET(new Request('http://x'))
    expect(await res.json()).toMatchObject({ sent: 2 })
    expect(recordHeartbeat).toHaveBeenCalledWith('send-queue', expect.objectContaining({ sent: 2 }))
  })
})
```

- [ ] **Step 7: Record a heartbeat from the sequence runner**

In `src/app/api/cron/sequence-runner/route.ts`:

1. Replace the inline `CRON_SECRET` check with:

   ```ts
   if (!isAuthorizedCron(request)) {
     return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
   }
   ```

2. Before the final `return NextResponse.json(...)`, add:

   ```ts
   await recordHeartbeat('sequence-runner', { processed: results.length })
   ```

3. Add `import { isAuthorizedCron, recordHeartbeat } from '@/lib/cron'`.

In `route.test.ts`:

1. Add `cronHeartbeat: { upsert: vi.fn() },` to the prisma mock.
2. Keep the existing 401 assertions. They still pass, because
   `isAuthorizedCron` reads the same `CRON_SECRET` env var.

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/lib/cron.test.ts src/features/messages src/app/api/cron && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/cron* src/features/messages/server/process-send-queue* src/app/api/cron
git commit -m "feat(messages): paced business-hours send queue with crash-safe Graph sends"
```

---

### Task 13: Inbox monitor

**Files:**
- Create: `src/features/replies/server/record-reply.ts`
- Test: `src/features/replies/server/record-reply.test.ts`
- Modify: `src/features/replies/server/ingest-reply.ts`
- Create: `src/features/inbox/server/monitor-mailboxes.ts`
- Test: `src/features/inbox/server/monitor-mailboxes.test.ts`
- Create: `src/app/api/cron/inbox-monitor/route.ts`
- Test: `src/app/api/cron/inbox-monitor/route.test.ts`

**Interfaces:**
- Consumes:
  - `classifyInboundMessage`, `extractBouncedRecipients` (Task 4)
  - `fetchFolderDelta`, `GraphMessage`, and the Graph errors (Tasks 5–6)
  - `notifyReply`, `notifyUnmatchedReply` (Task 9)
  - `pauseOrgSending` (Task 12)
  - `recordHeartbeat` (Task 12)
  - `evaluateMailboxBreaker`, `transitionLeadStatus` (existing)
- Produces:
  - `recordReply(input: RecordReplyInput): Promise<InboundReply>`, where
    `RecordReplyInput = { organizationId; leadId; outboundMessageId: string | null; rawBody; receivedAt?: Date; mailboxId?: string; graphMessageId?: string; conversationId?: string | null; fromEmail?: string; subject?: string }`
  - `monitorMailboxes(now?: Date, budgetMs?: number): Promise<MonitorResult>`
  - `interface MonitorResult { mailboxes: number; replies: number; unmatched: number; bounces: number; autoReplies: number; handled: number; notified: number }`
  - `INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000`

- [ ] **Step 1: Extract `recordReply`**

Move steps 3–6 of `ingestReply` into `record-reply.ts`: the prompt lookup,
classification, persistence, and status transition, as below. Then make
`ingestReply` call it after it resolves the lead and `outboundMessageId`.
`ingestReply`'s existing tests must pass unchanged.

```ts
import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { CLASSIFICATION_TO_STATUS } from '@/features/leads/types'

export const FALLBACK_CLASSIFY_PROMPT = `You are an email reply classifier for a sales team.
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

export interface RecordReplyInput {
  organizationId: string
  leadId: string
  outboundMessageId: string | null
  rawBody: string
  receivedAt?: Date
  mailboxId?: string
  graphMessageId?: string
  conversationId?: string | null
  fromEmail?: string
  subject?: string
}

/** Classify (AI, outside any tx), persist, and auto-transition the lead. */
export async function recordReply(input: RecordReplyInput) {
  const template = await prisma.promptTemplate.findFirst({
    where: { organizationId: input.organizationId, promptType: 'REPLY_CLASSIFICATION', isActive: true },
  })
  const prompt = template?.body ?? FALLBACK_CLASSIFY_PROMPT

  if (input.rawBody.length > 50_000) {
    throw new Error('Reply body exceeds maximum allowed length')
  }
  const { classification, confidence } = await getAIProvider().classifyReply({ rawBody: input.rawBody }, prompt)

  const reply = await prisma.inboundReply.create({
    data: {
      organizationId: input.organizationId,
      leadId: input.leadId,
      outboundMessageId: input.outboundMessageId,
      rawBody: input.rawBody,
      classification,
      classificationConfidence: confidence,
      ...(input.receivedAt !== undefined && { receivedAt: input.receivedAt }),
      ...(input.mailboxId && { mailboxId: input.mailboxId }),
      ...(input.graphMessageId && { graphMessageId: input.graphMessageId }),
      ...(input.conversationId && { conversationId: input.conversationId }),
      ...(input.fromEmail && { fromEmail: input.fromEmail }),
      ...(input.subject && { subject: input.subject }),
    },
  })

  const targetStatus = CLASSIFICATION_TO_STATUS[classification]
  if (targetStatus) {
    await transitionLeadStatus({
      organizationId: input.organizationId,
      leadId: input.leadId,
      newStatus: targetStatus,
      trigger: 'auto:reply_classification',
      metadata: { replyId: reply.id, classification, confidence },
    })
  }
  return reply
}
```

In `ingest-reply.ts`:

1. Delete `FALLBACK_CLASSIFY_PROMPT` and steps 3–6.
2. Add `import { recordReply } from './record-reply'`.
3. Replace the removed code with:

   ```ts
   const reply = await recordReply({ organizationId, leadId: lead.id, outboundMessageId, rawBody, receivedAt })
   ```

4. Keep the DTO mapping.
5. Remove imports that are no longer used.

`record-reply.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { promptTemplate: { findFirst: vi.fn() }, inboundReply: { create: vi.fn() } },
}))
vi.mock('@/lib/ai', () => ({ getAIProvider: vi.fn() }))
vi.mock('@/features/leads/server/transition-lead-status', () => ({ transitionLeadStatus: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { recordReply } from './record-reply'

type Fn = ReturnType<typeof vi.fn>
const classifyReply = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  ;(getAIProvider as Fn).mockReturnValue({ classifyReply })
  classifyReply.mockResolvedValue({ classification: 'POSITIVE', confidence: 0.9 })
  ;(prisma.promptTemplate.findFirst as Fn).mockResolvedValue(null)
  ;(prisma.inboundReply.create as Fn).mockImplementation(async ({ data }: { data: object }) => ({ id: 'r1', ...data }))
})

describe('recordReply', () => {
  it('persists Graph fields and transitions the lead per classification', async () => {
    const reply = await recordReply({
      organizationId: 'org-1', leadId: 'lead-1', outboundMessageId: 'om-1', rawBody: 'Quote us please',
      mailboxId: 'mb-1', graphMessageId: 'gm-1', conversationId: 'conv-1', fromEmail: 'jane@acmepm.com', subject: 'Re: Snow',
    })
    expect(reply.id).toBe('r1')
    expect(prisma.inboundReply.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1', leadId: 'lead-1', outboundMessageId: 'om-1', classification: 'POSITIVE',
        classificationConfidence: 0.9, mailboxId: 'mb-1', graphMessageId: 'gm-1', conversationId: 'conv-1',
        fromEmail: 'jane@acmepm.com', subject: 'Re: Snow',
      }),
    })
    expect(transitionLeadStatus).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-1', newStatus: 'INTERESTED' }))
  })

  it('rejects bodies over 50,000 characters without calling AI', async () => {
    await expect(
      recordReply({ organizationId: 'org-1', leadId: 'lead-1', outboundMessageId: null, rawBody: 'x'.repeat(50_001) }),
    ).rejects.toThrow(/maximum allowed length/)
    expect(classifyReply).not.toHaveBeenCalled()
  })
})
```

Run: `npx vitest run src/features/replies`
Expected: PASS, including the unchanged `ingest-reply` tests.

- [ ] **Step 2: Write the failing monitor tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    mailbox: { findMany: vi.fn(), update: vi.fn() },
    outboundMessage: { findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    lead: { findFirst: vi.fn() },
    inboundReply: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    unmatchedReply: { upsert: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    messageEvent: { create: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))
vi.mock('@/lib/email/graph/mail', () => ({ fetchFolderDelta: vi.fn() }))
vi.mock('@/features/replies/server/record-reply', () => ({ recordReply: vi.fn() }))
vi.mock('@/features/replies/server/notify', () => ({ notifyReply: vi.fn(), notifyUnmatchedReply: vi.fn() }))
vi.mock('@/features/messages/server/process-send-queue', () => ({ pauseOrgSending: vi.fn() }))
vi.mock('@/features/leads/server/transition-lead-status', () => ({ transitionLeadStatus: vi.fn() }))
vi.mock('@/features/mailboxes/server/evaluate-mailbox-breaker', () => ({ evaluateMailboxBreaker: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { fetchFolderDelta } from '@/lib/email/graph/mail'
import { recordReply } from '@/features/replies/server/record-reply'
import { notifyReply, notifyUnmatchedReply } from '@/features/replies/server/notify'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { evaluateMailboxBreaker } from '@/features/mailboxes/server/evaluate-mailbox-breaker'
import { pauseOrgSending } from '@/features/messages/server/process-send-queue'
import { GraphAuthError, GraphError } from '@/lib/email/graph/client'
import { monitorMailboxes } from './monitor-mailboxes'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as Record<string, Record<string, Fn>>
const delta = fetchFolderDelta as Fn
const NOW = new Date('2026-09-23T14:00:00Z')

const mb = {
  id: 'mb-1', organizationId: 'org-1', email: 'mike@getacmesnow.com',
  inboxDeltaLink: 'https://graph.microsoft.com/v1.0/inbox-d1', sentDeltaLink: 'https://graph.microsoft.com/v1.0/sent-d1',
  organization: { msTenantId: 'tenant-1', mailboxes: [{ email: 'mike@getacmesnow.com' }] },
}
const human = {
  id: 'gm-1', conversationId: 'conv-1', subject: 'Re: Snow plan', from: { emailAddress: { address: 'Jane@AcmePM.com' } },
  receivedDateTime: '2026-09-23T13:58:00Z', body: { contentType: 'text', content: 'Yes please quote us' }, internetMessageHeaders: [],
}

function inboxThenSent(inbox: unknown[], sent: unknown[] = []) {
  delta.mockImplementation(async (_t: string, _m: string, folder: string) =>
    folder === 'inbox'
      ? { messages: inbox, resumeLink: 'https://graph.microsoft.com/v1.0/inbox-d2' }
      : { messages: sent, resumeLink: 'https://graph.microsoft.com/v1.0/sent-d2' },
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MS_NOTIFY_MAILBOX = 'alerts@getacmesnow.com'
  p.mailbox.findMany.mockResolvedValue([mb])
  p.inboundReply.findUnique.mockResolvedValue(null)
  p.inboundReply.findMany.mockResolvedValue([])
  p.unmatchedReply.findMany.mockResolvedValue([])
  p.outboundMessage.findMany.mockResolvedValue([])
  ;(recordReply as Fn).mockResolvedValue({ id: 'r1', classification: 'POSITIVE' })
  ;(notifyReply as Fn).mockResolvedValue(true)
})

describe('monitorMailboxes', () => {
  it('human reply matched by conversation: records, stops enrollments, cancels queued mail, notifies, saves delta links', async () => {
    inboxThenSent([human])
    p.outboundMessage.findFirst.mockResolvedValue({ id: 'om-1', leadId: 'lead-1' })
    const res = await monitorMailboxes(NOW)
    expect(recordReply).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: 'org-1', leadId: 'lead-1', outboundMessageId: 'om-1', rawBody: 'Yes please quote us',
      mailboxId: 'mb-1', graphMessageId: 'gm-1', conversationId: 'conv-1', fromEmail: 'jane@acmepm.com',
    }))
    expect(p.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1', organizationId: 'org-1', status: 'ACTIVE' },
      data: { status: 'STOPPED', stoppedAt: expect.any(Date), stoppedReason: 'reply_received' },
    })
    expect(p.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { leadId: 'lead-1', organizationId: 'org-1', status: 'QUEUED', processing: false },
      data: { status: 'CANCELLED', lastError: 'reply_received' },
    })
    expect(notifyReply).toHaveBeenCalledWith('r1')
    expect(p.mailbox.update).toHaveBeenCalledWith({
      where: { id: 'mb-1' },
      data: { inboxDeltaLink: 'https://graph.microsoft.com/v1.0/inbox-d2', sentDeltaLink: 'https://graph.microsoft.com/v1.0/sent-d2', lastPolledAt: NOW },
    })
    expect(res.replies).toBe(1)
  })

  it('falls back to matching by sender email (case-insensitive)', async () => {
    inboxThenSent([{ ...human, conversationId: 'unknown' }])
    p.outboundMessage.findFirst.mockResolvedValue(null)
    p.lead.findFirst.mockResolvedValue({ id: 'lead-7' })
    await monitorMailboxes(NOW)
    expect(p.lead.findFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', email: { equals: 'jane@acmepm.com', mode: 'insensitive' } },
      select: { id: true },
    })
    expect((recordReply as Fn).mock.calls[0][0].leadId).toBe('lead-7')
  })

  it('same message seen twice → one reply, one notification (Review Focus #4)', async () => {
    inboxThenSent([human, human])
    p.outboundMessage.findFirst.mockResolvedValue({ id: 'om-1', leadId: 'lead-1' })
    p.inboundReply.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'r1' })
    await monitorMailboxes(NOW)
    expect(recordReply).toHaveBeenCalledTimes(1)
    expect(notifyReply).toHaveBeenCalledTimes(1)
  })

  it('a unique-constraint race on graphMessageId is treated as already processed', async () => {
    inboxThenSent([human])
    p.outboundMessage.findFirst.mockResolvedValue({ id: 'om-1', leadId: 'lead-1' })
    ;(recordReply as Fn).mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '7' }))
    await expect(monitorMailboxes(NOW)).resolves.toMatchObject({ replies: 0 })
    expect(notifyReply).not.toHaveBeenCalled()
  })

  it('unsubscribe request: recorded, no notification', async () => {
    inboxThenSent([human])
    p.outboundMessage.findFirst.mockResolvedValue({ id: 'om-1', leadId: 'lead-1' })
    ;(recordReply as Fn).mockResolvedValue({ id: 'r1', classification: 'UNSUBSCRIBE_REQUEST' })
    await monitorMailboxes(NOW)
    expect(notifyReply).not.toHaveBeenCalled()
  })

  it('unmatched human reply is stored and notified', async () => {
    inboxThenSent([{ ...human, from: { emailAddress: { address: 'bob@acmepm.com' } } }])
    p.outboundMessage.findFirst.mockResolvedValue(null)
    p.lead.findFirst.mockResolvedValue(null)
    p.unmatchedReply.upsert.mockResolvedValue({ id: 'u1', notifiedAt: null })
    const res = await monitorMailboxes(NOW)
    expect(p.unmatchedReply.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { graphMessageId: 'gm-1' } }))
    expect(notifyUnmatchedReply).toHaveBeenCalledWith('u1')
    expect(res.unmatched).toBe(1)
  })

  it('bounce: records BOUNCED event, bounces the lead, stops, and evaluates the breaker', async () => {
    inboxThenSent([{
      id: 'gm-2', conversationId: 'c2', subject: 'Undeliverable: Snow plan',
      from: { emailAddress: { address: 'postmaster@getacmesnow.com' } },
      body: { contentType: 'text', content: "Your message to bob@nowhere.example couldn't be delivered." },
    }])
    p.outboundMessage.findFirst.mockResolvedValue({ id: 'om-9', leadId: 'lead-9' })
    const res = await monitorMailboxes(NOW)
    expect(p.messageEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-1', outboundMessageId: 'om-9', eventType: 'BOUNCED', sgEventId: 'graph:gm-2' }),
    })
    expect(transitionLeadStatus).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-9', newStatus: 'BOUNCED' }))
    expect(evaluateMailboxBreaker).toHaveBeenCalledWith('mb-1')
    expect(recordReply).not.toHaveBeenCalled()
    expect(res.bounces).toBe(1)
  })

  it('auto-reply: audit-logged only, sequence untouched', async () => {
    inboxThenSent([{ ...human, subject: 'Automatic reply: Snow plan' }])
    const res = await monitorMailboxes(NOW)
    expect(p.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'reply.auto_reply' }) })
    expect(recordReply).not.toHaveBeenCalled()
    expect(p.sequenceEnrollment.updateMany).not.toHaveBeenCalled()
    expect(res.autoReplies).toBe(1)
  })

  it('sent items: a human-written reply in a tracked conversation marks it handled', async () => {
    inboxThenSent([], [{ id: 'sent-1', conversationId: 'conv-1', sentDateTime: '2026-09-23T13:59:00Z' }])
    p.outboundMessage.findMany.mockResolvedValue([]) // sent-1 is not one of ours
    p.inboundReply.updateMany.mockResolvedValue({ count: 1 })
    p.unmatchedReply.updateMany.mockResolvedValue({ count: 0 })
    const res = await monitorMailboxes(NOW)
    expect(p.inboundReply.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', conversationId: 'conv-1', handledAt: null },
      data: { handledAt: new Date('2026-09-23T13:59:00Z') },
    })
    expect(res.handled).toBe(1)
  })

  it('sent items: our own auto-sent messages never mark anything handled', async () => {
    inboxThenSent([], [{ id: 'g1', conversationId: 'conv-1', sentDateTime: '2026-09-23T13:59:00Z' }])
    p.outboundMessage.findMany.mockResolvedValue([{ graphMessageId: 'g1' }])
    await monitorMailboxes(NOW)
    expect(p.inboundReply.updateMany).not.toHaveBeenCalled()
  })

  it('expired delta link (410): clears the stored link so the next tick restarts with a 24h lookback', async () => {
    delta.mockRejectedValue(new GraphError('gone', 410, 'SyncStateNotFound'))
    await monitorMailboxes(NOW)
    expect(p.mailbox.update).toHaveBeenCalledWith({ where: { id: 'mb-1' }, data: { inboxDeltaLink: null, sentDeltaLink: null } })
  })

  it('auth error pauses the org', async () => {
    delta.mockRejectedValue(new GraphAuthError('denied', 403))
    await monitorMailboxes(NOW)
    expect(pauseOrgSending).toHaveBeenCalledWith('org-1', expect.stringContaining('Microsoft 365'))
  })

  it('re-sweeps replies whose notification failed earlier', async () => {
    inboxThenSent([])
    p.inboundReply.findMany.mockResolvedValue([{ id: 'r-old' }])
    await monitorMailboxes(NOW)
    expect(notifyReply).toHaveBeenCalledWith('r-old')
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/features/inbox/server/monitor-mailboxes.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `monitor-mailboxes.ts`**

```ts
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { fetchFolderDelta, type GraphMessage } from '@/lib/email/graph/mail'
import { GraphAuthError, GraphError, GraphThrottledError } from '@/lib/email/graph/client'
import { classifyInboundMessage, extractBouncedRecipients, type InboundMessage } from '../classify-inbound'
import { recordReply } from '@/features/replies/server/record-reply'
import { notifyReply, notifyUnmatchedReply } from '@/features/replies/server/notify'
import { pauseOrgSending } from '@/features/messages/server/process-send-queue'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { evaluateMailboxBreaker } from '@/features/mailboxes/server/evaluate-mailbox-breaker'

export const INITIAL_LOOKBACK_MS = 24 * 60 * 60 * 1000
const RESWEEP_WINDOW_MS = 24 * 60 * 60 * 1000
const NO_NOTIFY = new Set(['UNSUBSCRIBE_REQUEST', 'OUT_OF_OFFICE'])

export interface MonitorResult {
  mailboxes: number
  replies: number
  unmatched: number
  bounces: number
  autoReplies: number
  handled: number
  notified: number
}

type MailboxWithOrg = {
  id: string
  organizationId: string
  email: string
  inboxDeltaLink: string | null
  sentDeltaLink: string | null
  organization: { msTenantId: string | null; mailboxes: { email: string }[] }
}

export async function monitorMailboxes(now: Date = new Date(), budgetMs = 45_000): Promise<MonitorResult> {
  const startedAt = Date.now()
  const result: MonitorResult = { mailboxes: 0, replies: 0, unmatched: 0, bounces: 0, autoReplies: 0, handled: 0, notified: 0 }

  const mailboxes = (await prisma.mailbox.findMany({
    where: { provider: 'MICROSOFT_GRAPH', organization: { msTenantId: { not: null } } },
    orderBy: { lastPolledAt: { sort: 'asc', nulls: 'first' } },
    select: {
      id: true, organizationId: true, email: true, inboxDeltaLink: true, sentDeltaLink: true,
      organization: { select: { msTenantId: true, mailboxes: { select: { email: true } } } },
    },
  })) as MailboxWithOrg[]

  for (const mailbox of mailboxes) {
    if (Date.now() - startedAt > budgetMs) break
    try {
      await pollMailbox(mailbox, now, result)
      result.mailboxes++
    } catch (err) {
      if (err instanceof GraphAuthError) {
        await pauseOrgSending(
          mailbox.organizationId,
          `Microsoft 365 denied OutboundOS access to ${mailbox.email} (HTTP ${err.status}: ${err.message}). Check admin consent and the Sending Mailboxes access policy.`,
        )
      } else if (err instanceof GraphError && err.status === 410) {
        await prisma.mailbox.update({ where: { id: mailbox.id }, data: { inboxDeltaLink: null, sentDeltaLink: null } })
      } else if (!(err instanceof GraphThrottledError)) {
        console.error(`[inbox-monitor] mailbox ${mailbox.email} failed`, err)
      }
    }
  }

  // Re-sweep notifications that failed on an earlier tick.
  const since = new Date(now.getTime() - RESWEEP_WINDOW_MS)
  const pending = await prisma.inboundReply.findMany({
    where: {
      notifiedAt: null,
      graphMessageId: { not: null },
      createdAt: { gte: since },
      classification: { notIn: ['UNSUBSCRIBE_REQUEST', 'OUT_OF_OFFICE'] },
    },
    select: { id: true },
    take: 20,
  })
  for (const r of pending) if (await notifyReply(r.id)) result.notified++
  const pendingUnmatched = await prisma.unmatchedReply.findMany({
    where: { notifiedAt: null, createdAt: { gte: since } },
    select: { id: true },
    take: 20,
  })
  for (const u of pendingUnmatched) if (await notifyUnmatchedReply(u.id)) result.notified++

  return result
}

async function pollMailbox(mailbox: MailboxWithOrg, now: Date, result: MonitorResult): Promise<void> {
  const tenantId = mailbox.organization.msTenantId!
  const since = new Date(now.getTime() - INITIAL_LOOKBACK_MS)
  const own = new Set(
    [...mailbox.organization.mailboxes.map((m) => m.email), process.env.MS_NOTIFY_MAILBOX ?? '']
      .filter(Boolean)
      .map((e) => e.toLowerCase()),
  )

  const inbox = await fetchFolderDelta(tenantId, mailbox.email, 'inbox', mailbox.inboxDeltaLink, since)
  for (const msg of inbox.messages) {
    if (msg['@removed']) continue
    await processInbound(mailbox, msg, own, result)
  }

  const sent = await fetchFolderDelta(tenantId, mailbox.email, 'sentitems', mailbox.sentDeltaLink, since)
  await processSent(mailbox, sent.messages.filter((m) => !m['@removed']), result)

  await prisma.mailbox.update({
    where: { id: mailbox.id },
    data: { inboxDeltaLink: inbox.resumeLink, sentDeltaLink: sent.resumeLink, lastPolledAt: now },
  })
}

function toInbound(msg: GraphMessage): InboundMessage {
  const headers: Record<string, string> = {}
  for (const h of msg.internetMessageHeaders ?? []) headers[h.name.toLowerCase()] = h.value
  return {
    fromAddress: msg.from?.emailAddress?.address ?? '',
    subject: msg.subject ?? '',
    bodyText: msg.body?.content ?? msg.bodyPreview ?? '',
    headers,
  }
}

async function processInbound(
  mailbox: MailboxWithOrg,
  msg: GraphMessage,
  own: ReadonlySet<string>,
  result: MonitorResult,
): Promise<void> {
  const inbound = toInbound(msg)
  const kind = classifyInboundMessage(inbound, own)
  const orgId = mailbox.organizationId

  if (kind === 'INTERNAL') return

  if (kind === 'AUTO_REPLY') {
    await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        action: 'reply.auto_reply',
        entityType: 'Mailbox',
        entityId: mailbox.id,
        metadata: { graphMessageId: msg.id, from: inbound.fromAddress, subject: inbound.subject },
      },
    })
    result.autoReplies++
    return
  }

  if (kind === 'BOUNCE') {
    const recipients = extractBouncedRecipients(inbound.bodyText, own)
    if (recipients.length === 0) return
    const original = await prisma.outboundMessage.findFirst({
      where: {
        mailboxId: mailbox.id,
        status: { in: ['SENT', 'DELIVERED'] },
        lead: { email: { in: recipients, mode: 'insensitive' } },
      },
      orderBy: { sentAt: 'desc' },
      select: { id: true, leadId: true },
    })
    if (!original) return
    try {
      await prisma.messageEvent.create({
        data: {
          organizationId: orgId,
          outboundMessageId: original.id,
          // sgEventId is the provider-event dedupe key; Graph NDRs use their message id.
          sgEventId: `graph:${msg.id}`,
          eventType: 'BOUNCED',
          providerEventType: 'graph_ndr',
          providerTimestamp: msg.receivedDateTime ? new Date(msg.receivedDateTime) : null,
          rawPayload: { subject: inbound.subject, recipients },
        },
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return
      throw err
    }
    await prisma.outboundMessage.update({ where: { id: original.id }, data: { status: 'BOUNCED' } })
    await transitionLeadStatus({
      organizationId: orgId,
      leadId: original.leadId,
      newStatus: 'BOUNCED',
      trigger: 'auto:bounce',
      metadata: { outboundMessageId: original.id },
    })
    await evaluateMailboxBreaker(mailbox.id).catch((err) => console.error('[inbox-monitor] breaker', err))
    result.bounces++
    return
  }

  // HUMAN
  if (await prisma.inboundReply.findUnique({ where: { graphMessageId: msg.id }, select: { id: true } })) return

  const fromEmail = inbound.fromAddress.toLowerCase()
  const byConversation = msg.conversationId
    ? await prisma.outboundMessage.findFirst({
        where: { organizationId: orgId, conversationId: msg.conversationId },
        select: { id: true, leadId: true },
      })
    : null
  const leadId =
    byConversation?.leadId ??
    (await prisma.lead.findFirst({
      where: { organizationId: orgId, email: { equals: fromEmail, mode: 'insensitive' } },
      select: { id: true },
    }))?.id

  if (!leadId) {
    const unmatched = await prisma.unmatchedReply.upsert({
      where: { graphMessageId: msg.id },
      create: {
        organizationId: orgId,
        mailboxId: mailbox.id,
        graphMessageId: msg.id,
        conversationId: msg.conversationId ?? null,
        fromEmail,
        subject: inbound.subject,
        bodyPreview: inbound.bodyText.slice(0, 2000),
        receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : new Date(),
      },
      update: {},
    })
    if (!unmatched.notifiedAt) await notifyUnmatchedReply(unmatched.id)
    result.unmatched++
    return
  }

  let reply: { id: string; classification: string }
  try {
    reply = await recordReply({
      organizationId: orgId,
      leadId,
      outboundMessageId: byConversation?.id ?? null,
      rawBody: inbound.bodyText.slice(0, 50_000),
      receivedAt: msg.receivedDateTime ? new Date(msg.receivedDateTime) : undefined,
      mailboxId: mailbox.id,
      graphMessageId: msg.id,
      conversationId: msg.conversationId ?? null,
      fromEmail,
      subject: inbound.subject,
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return // processed concurrently
    throw err
  }

  // Stop everything for this lead right now — don't wait for the next runner tick.
  await prisma.sequenceEnrollment.updateMany({
    where: { leadId, organizationId: orgId, status: 'ACTIVE' },
    data: { status: 'STOPPED', stoppedAt: new Date(), stoppedReason: 'reply_received' },
  })
  await prisma.outboundMessage.updateMany({
    where: { leadId, organizationId: orgId, status: 'QUEUED', processing: false },
    data: { status: 'CANCELLED', lastError: 'reply_received' },
  })

  result.replies++
  if (!NO_NOTIFY.has(reply.classification)) await notifyReply(reply.id)
}

async function processSent(mailbox: MailboxWithOrg, messages: GraphMessage[], result: MonitorResult): Promise<void> {
  if (messages.length === 0) return
  const ours = await prisma.outboundMessage.findMany({
    where: { graphMessageId: { in: messages.map((m) => m.id) } },
    select: { graphMessageId: true },
  })
  const ourIds = new Set(ours.map((o) => o.graphMessageId))

  for (const m of messages) {
    if (ourIds.has(m.id) || !m.conversationId) continue
    const handledAt = m.sentDateTime ? new Date(m.sentDateTime) : new Date()
    const r = await prisma.inboundReply.updateMany({
      where: { organizationId: mailbox.organizationId, conversationId: m.conversationId, handledAt: null },
      data: { handledAt },
    })
    const u = await prisma.unmatchedReply.updateMany({
      where: { organizationId: mailbox.organizationId, conversationId: m.conversationId, handledAt: null },
      data: { handledAt },
    })
    result.handled += r.count + u.count
  }
}
```

- [ ] **Step 5: Write the cron route and its test**

`src/app/api/cron/inbox-monitor/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
import { monitorMailboxes } from '@/features/inbox/server/monitor-mailboxes'

export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const result = await monitorMailboxes()
  await recordHeartbeat('inbox-monitor', result)
  return NextResponse.json(result)
}
```

`src/app/api/cron/inbox-monitor/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cron', () => ({ isAuthorizedCron: vi.fn(), recordHeartbeat: vi.fn() }))
vi.mock('@/features/inbox/server/monitor-mailboxes', () => ({ monitorMailboxes: vi.fn() }))

import { isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
import { monitorMailboxes } from '@/features/inbox/server/monitor-mailboxes'
import { GET } from './route'

beforeEach(() => vi.resetAllMocks())

describe('GET /api/cron/inbox-monitor', () => {
  it('401 without the cron secret', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(false)
    expect((await GET(new Request('http://x'))).status).toBe(401)
    expect(monitorMailboxes).not.toHaveBeenCalled()
  })
  it('runs the monitor and records a heartbeat', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const result = { mailboxes: 3, replies: 1, unmatched: 0, bounces: 0, autoReplies: 0, handled: 0, notified: 1 }
    ;(monitorMailboxes as ReturnType<typeof vi.fn>).mockResolvedValue(result)
    const res = await GET(new Request('http://x'))
    expect(await res.json()).toEqual(result)
    expect(recordHeartbeat).toHaveBeenCalledWith('inbox-monitor', result)
  })
})
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/replies src/features/inbox src/app/api/cron && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/replies src/features/inbox src/app/api/cron/inbox-monitor
git commit -m "feat(inbox): Graph delta inbox monitor — replies, bounces, auto-replies, handled detection"
```

---

### Task 14: Heartbeat check and system banner

**Files:**
- Create: `src/app/api/cron/heartbeat-check/route.ts`
- Test: `src/app/api/cron/heartbeat-check/route.test.ts`
- Modify: `vercel.json`
- Create: `src/components/layout/system-banner.tsx`
- Modify: `src/app/(dashboard)/layout.tsx`

**Interfaces:**
- Consumes: `getStaleJobs`, `isAuthorizedCron` (Task 12); `sendOrgAlert`
  (Task 9).
- Produces: `<SystemBanner />`, an async server component.

- [ ] **Step 1: Write the failing route test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cron', () => ({ isAuthorizedCron: vi.fn(), getStaleJobs: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findMany: vi.fn() } } }))
vi.mock('@/features/replies/server/notify', () => ({ sendOrgAlert: vi.fn() }))

import { isAuthorizedCron, getStaleJobs } from '@/lib/cron'
import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { GET } from './route'

type Fn = ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetAllMocks()
  ;(isAuthorizedCron as Fn).mockReturnValue(true)
})

describe('GET /api/cron/heartbeat-check', () => {
  it('401 without the secret', async () => {
    ;(isAuthorizedCron as Fn).mockReturnValue(false)
    expect((await GET(new Request('http://x'))).status).toBe(401)
  })
  it('alerts every org with an escalation address when jobs are stale', async () => {
    ;(getStaleJobs as Fn).mockResolvedValue(['send-queue'])
    ;(prisma.organization.findMany as Fn).mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }])
    const res = await GET(new Request('http://x'))
    expect(await res.json()).toEqual({ stale: ['send-queue'], alerted: 2 })
    expect(sendOrgAlert).toHaveBeenCalledWith('org-1', 'Scheduler has stopped', expect.stringContaining('send-queue'))
  })
  it('does nothing when all jobs are fresh', async () => {
    ;(getStaleJobs as Fn).mockResolvedValue([])
    const res = await GET(new Request('http://x'))
    expect(await res.json()).toEqual({ stale: [], alerted: 0 })
    expect(sendOrgAlert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Implement the route**

```ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { getStaleJobs, isAuthorizedCron } from '@/lib/cron'
import { sendOrgAlert } from '@/features/replies/server/notify'

// Daily Vercel cron. The 5-minute jobs are driven by cron-job.org; if that
// silently stops, this is the tripwire.
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stale = await getStaleJobs()
  if (stale.length === 0) return NextResponse.json({ stale, alerted: 0 })

  const orgs = await prisma.organization.findMany({ where: { escalationEmail: { not: null } }, select: { id: true } })
  let alerted = 0
  for (const org of orgs) {
    const ok = await sendOrgAlert(
      org.id,
      'Scheduler has stopped',
      `These background jobs haven't run in over 30 minutes: ${stale.join(', ')}.\n\nEmails are not being sent and replies are not being detected. Check the jobs at cron-job.org (they must call the endpoints every 5 minutes with the Authorization header).`,
    )
    if (ok) alerted++
  }
  return NextResponse.json({ stale, alerted })
}
```

Run: `npx vitest run src/app/api/cron/heartbeat-check`
Expected: PASS.

- [ ] **Step 3: Repoint the Vercel cron**

Replace `vercel.json` with:

```json
{
  "crons": [
    {
      "path": "/api/cron/heartbeat-check",
      "schedule": "0 16 * * 1-5"
    }
  ]
}
```

16:00 UTC is 11:00 or 12:00 Eastern, which is during business hours. Vercel
sends `Authorization: Bearer $CRON_SECRET` automatically when `CRON_SECRET`
is set in the project.

- [ ] **Step 4: Add the system banner**

`src/components/layout/system-banner.tsx`:

```tsx
import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { AlertTriangle } from 'lucide-react'
import { prisma } from '@/lib/db/prisma'
import { getStaleJobs } from '@/lib/cron'

// Server component: shown above every dashboard page when automatic sending is
// paused or the external scheduler has gone quiet.
export async function SystemBanner() {
  const { orgId } = await auth()
  if (!orgId) return null

  const org = await prisma.organization.findUnique({
    where: { clerkId: orgId },
    select: { sendingPaused: true, pausedReason: true, msTenantId: true },
  })
  if (!org?.msTenantId) return null

  const stale = await getStaleJobs()
  const messages: string[] = []
  if (org.sendingPaused) messages.push(`Sending is paused${org.pausedReason ? `: ${org.pausedReason}` : '.'}`)
  if (stale.length > 0) messages.push(`Background jobs haven't run in 30+ minutes (${stale.join(', ')}).`)
  if (messages.length === 0) return null

  return (
    <div role="alert" className="flex items-start gap-3 px-6 py-3 bg-[var(--status-danger-bg,#fef2f2)] border-b border-[var(--status-danger,#dc2626)] text-sm text-[var(--text-primary)]">
      <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--status-danger,#dc2626)]" aria-hidden />
      <div className="space-y-1">
        {messages.map((m) => <p key={m}>{m}</p>)}
        <Link href="/settings" className="text-[var(--accent-indigo)] text-xs">Open settings →</Link>
      </div>
    </div>
  )
}
```

In `src/app/(dashboard)/layout.tsx`:

1. Import `SystemBanner`.
2. Render it as the first child inside `<DashboardMain>`:

   ```tsx
   <DashboardMain>
     <SystemBanner />
     {children}
   </DashboardMain>
   ```

Before committing, run
`grep -n "status-danger" src/app/globals.css` to confirm the token name. If
the theme uses a different danger token, use that instead of the fallback
hex values.

- [ ] **Step 5: Typecheck, test, and eyeball it**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

Run `npm run dev`. In the local database, set
`UPDATE organizations SET "msTenantId"='x', "sendingPaused"=true, "pausedReason"='test'`,
then open `/dashboard`.
Expected: the red banner shows the reason plus the stale-jobs line. Revert
the SQL afterwards.

- [ ] **Step 6: Commit**

```bash
git add vercel.json src/app/api/cron/heartbeat-check src/components/layout/system-banner.tsx src/app/\(dashboard\)/layout.tsx
git commit -m "feat(ops): daily scheduler tripwire and dashboard banner for paused or stale sending"
```

---

### Task 15: Microsoft 365 connect and mailbox import

**Files:**
- Create: `src/features/integrations/server/microsoft.ts`
- Test: `src/features/integrations/server/microsoft.test.ts`
- Create: `src/app/api/integrations/microsoft/connect/route.ts`
- Create: `src/app/api/integrations/microsoft/callback/route.ts`
- Test: `src/app/api/integrations/microsoft/callback/route.test.ts`
- Create: `src/app/api/integrations/microsoft/users/route.ts`
- Create: `src/app/api/integrations/microsoft/mailboxes/route.ts`

**Interfaces:**
- Consumes: `listTenantUsers` (Task 6).
- Produces:
  - `buildAdminConsentUrl(state: string): string`
  - `saveTenant(organizationId: string, tenantId: string): Promise<void>`
  - `importGraphMailboxes(organizationId: string, users: { id: string; email: string; displayName: string }[]): Promise<{ created: number }>`
  - `DEFAULT_GRAPH_DAILY_LIMIT = 30`
  - `CONNECT_STATE_COOKIE = 'ms_connect_state'`

- [ ] **Step 1: Write the failing server tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { organization: { update: vi.fn() }, mailbox: { createMany: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { buildAdminConsentUrl, saveTenant, importGraphMailboxes } from './microsoft'

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MS_GRAPH_CLIENT_ID = 'cid'
  process.env.NEXT_PUBLIC_APP_URL = 'https://app.test'
})

describe('microsoft integration', () => {
  it('builds the admin-consent URL with redirect and state', () => {
    const url = new URL(buildAdminConsentUrl('st8'))
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/organizations/v2.0/adminconsent')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/api/integrations/microsoft/callback')
    expect(url.searchParams.get('state')).toBe('st8')
    expect(url.searchParams.get('scope')).toBe('https://graph.microsoft.com/.default')
  })
  it('rejects a malformed tenant id', async () => {
    await expect(saveTenant('org-1', 'not a guid')).rejects.toThrow(/tenant/)
  })
  it('saves a GUID tenant id', async () => {
    await saveTenant('org-1', '72f988bf-86f1-41af-91ab-2d7cd011db47')
    expect(prisma.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { msTenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47', sendingPaused: false, pausedReason: null },
    })
  })
  it('imports Graph mailboxes with warmup on, 30/day, skipping duplicates', async () => {
    ;(prisma.mailbox.createMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 2 })
    const out = await importGraphMailboxes('org-1', [
      { id: 'u1', email: 'Mike@GetAcmeSnow.com', displayName: 'Mike Smith' },
      { id: 'u2', email: 'amy@getacmesnow.com', displayName: 'Amy Lee' },
    ])
    expect(out).toEqual({ created: 2 })
    expect(prisma.mailbox.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ organizationId: 'org-1', email: 'mike@getacmesnow.com', displayName: 'Mike Smith', provider: 'MICROSOFT_GRAPH', graphUserId: 'u1', dailyLimit: 30, warmupEnabled: true }),
        expect.objectContaining({ email: 'amy@getacmesnow.com', graphUserId: 'u2' }),
      ],
      skipDuplicates: true,
    })
  })
})
```

- [ ] **Step 2: Implement `microsoft.ts`**

```ts
import { prisma } from '@/lib/db/prisma'

export const DEFAULT_GRAPH_DAILY_LIMIT = 30
export const CONNECT_STATE_COOKIE = 'ms_connect_state'
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function buildAdminConsentUrl(state: string): string {
  const clientId = process.env.MS_GRAPH_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) throw new Error('MS_GRAPH_CLIENT_ID and NEXT_PUBLIC_APP_URL must be set')
  const url = new URL('https://login.microsoftonline.com/organizations/v2.0/adminconsent')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', 'https://graph.microsoft.com/.default')
  url.searchParams.set('redirect_uri', `${appUrl}/api/integrations/microsoft/callback`)
  url.searchParams.set('state', state)
  return url.toString()
}

export async function saveTenant(organizationId: string, tenantId: string): Promise<void> {
  if (!GUID.test(tenantId)) throw new Error(`Invalid tenant id: ${tenantId}`)
  await prisma.organization.update({
    where: { id: organizationId },
    // Reconnecting is how a human clears an auth-failure pause.
    data: { msTenantId: tenantId, sendingPaused: false, pausedReason: null },
  })
}

export async function importGraphMailboxes(
  organizationId: string,
  users: { id: string; email: string; displayName: string }[],
): Promise<{ created: number }> {
  const res = await prisma.mailbox.createMany({
    data: users.map((u) => ({
      organizationId,
      email: u.email.trim().toLowerCase(),
      displayName: u.displayName.trim() || u.email,
      provider: 'MICROSOFT_GRAPH' as const,
      graphUserId: u.id,
      dailyLimit: DEFAULT_GRAPH_DAILY_LIMIT,
      warmupEnabled: true,
      warmupStartedAt: new Date(),
    })),
    skipDuplicates: true,
  })
  return { created: res.count }
}
```

Run: `npx vitest run src/features/integrations`
Expected: PASS.

- [ ] **Step 3: Write the routes**

`connect/route.ts`:

```ts
import { randomBytes } from 'node:crypto'
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { buildAdminConsentUrl, CONNECT_STATE_COOKIE } from '@/features/integrations/server/microsoft'

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const state = randomBytes(24).toString('base64url')
  const res = NextResponse.redirect(buildAdminConsentUrl(state))
  res.cookies.set(CONNECT_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
```

`callback/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { saveTenant, CONNECT_STATE_COOKIE } from '@/features/integrations/server/microsoft'

function settingsRedirect(request: Request, status: string) {
  return NextResponse.redirect(new URL(`/settings?microsoft=${status}`, request.url))
}

export async function GET(request: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const params = new URL(request.url).searchParams
  const jar = await cookies()
  const expected = jar.get(CONNECT_STATE_COOKIE)?.value
  jar.delete(CONNECT_STATE_COOKIE)

  if (!expected || params.get('state') !== expected) return settingsRedirect(request, 'state_mismatch')
  if (params.get('error') || params.get('admin_consent') !== 'True') return settingsRedirect(request, 'denied')

  const tenant = params.get('tenant')
  if (!tenant) return settingsRedirect(request, 'denied')

  try {
    const org = await resolveOrganization(orgId)
    await saveTenant(org.id, tenant)
  } catch (err) {
    console.error('[microsoft callback]', err)
    return settingsRedirect(request, 'error')
  }
  return settingsRedirect(request, 'connected')
}
```

`callback/route.test.ts` covers four cases:
1. A state mismatch redirects to `/settings?microsoft=state_mismatch` and does
   not call `saveTenant`.
2. `admin_consent=False` redirects to `denied`.
3. Success calls `saveTenant('org-1', <tenant>)` and redirects to `connected`.
4. It deletes the state cookie.

Mock `@clerk/nextjs/server`, `next/headers` (`cookies: async () => ({ get, delete })`),
`@/lib/auth/resolve-organization`, and
`@/features/integrations/server/microsoft` (keep `CONNECT_STATE_COOKIE` real
via `importOriginal`).

`users/route.ts`: `GET`. It requires an org and `org.msTenantId`, returning
409 `{ error: 'Microsoft 365 not connected' }` otherwise. It returns
`listTenantUsers(org.msTenantId)` filtered to exclude
`process.env.MS_NOTIFY_MAILBOX` and emails already in the org's `Mailbox`
rows, compared case-insensitively.

`mailboxes/route.ts`: `POST { users: {id,email,displayName}[] }`. It requires
an org with `msTenantId`. It validates that the body is a non-empty array of
objects with string `id`/`email`/`displayName` (at most 50), returning 400
otherwise. It returns `importGraphMailboxes(...)` with status 201.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/integrations src/app/api/integrations && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/integrations src/app/api/integrations
git commit -m "feat(integrations): Microsoft 365 admin-consent connect and mailbox import"
```

---

### Task 16: Settings UI — Microsoft 365, sending schedule, escalation, pause

**Files:**
- Create: `src/features/settings/server/sending-settings.ts`
- Test: `src/features/settings/server/sending-settings.test.ts`
- Create: `src/app/api/settings/sending/route.ts`
- Create: `src/features/settings/components/microsoft-card.tsx`
- Create: `src/features/settings/components/sending-settings-form.tsx`
- Test: `src/features/settings/components/sending-settings-form.test.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`
- Modify: `src/app/(dashboard)/settings/settings-client.tsx`

**Interfaces:**
- Consumes: `isValidTimezone` (Task 2).
- Produces:
  - `interface SendingSettingsDTO { timezone: string; businessHoursStart: number; businessHoursEnd: number; sendDays: number[]; escalationEmail: string | null; sendingPaused: boolean; pausedReason: string | null; guardrailBlockedPhrases: string[]; guardrailAllowedWords: string[]; msConnected: boolean }`
  - `getSendingSettings(organizationId): Promise<SendingSettingsDTO>`
  - `updateSendingSettings(organizationId, patch: Partial<Omit<SendingSettingsDTO, 'pausedReason' | 'msConnected'>>): Promise<SendingSettingsDTO>`,
    which throws `SettingsValidationError`
  - `class SettingsValidationError extends Error`

- [ ] **Step 1: Write the failing server tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() } } }))

import { prisma } from '@/lib/db/prisma'
import { updateSendingSettings, SettingsValidationError } from './sending-settings'

const row = {
  timezone: 'America/New_York', businessHoursStart: 8, businessHoursEnd: 17, sendDays: [1, 2, 3, 4, 5],
  escalationEmail: null, sendingPaused: false, pausedReason: null, guardrailBlockedPhrases: [], guardrailAllowedWords: [], msTenantId: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  ;(prisma.organization.update as ReturnType<typeof vi.fn>).mockResolvedValue(row)
})

describe('updateSendingSettings', () => {
  it.each([
    [{ timezone: 'Mars/Olympus' }, /timezone/],
    [{ businessHoursStart: 17, businessHoursEnd: 8 }, /hours/],
    [{ businessHoursStart: -1 }, /hours/],
    [{ sendDays: [] }, /day/],
    [{ sendDays: [7] }, /day/],
    [{ escalationEmail: 'nope' }, /email/],
  ])('rejects %o', async (patch, msg) => {
    await expect(updateSendingSettings('org-1', patch)).rejects.toThrow(msg)
    await expect(updateSendingSettings('org-1', patch)).rejects.toBeInstanceOf(SettingsValidationError)
  })

  it('un-pausing clears pausedReason; phrases are trimmed and de-duplicated', async () => {
    await updateSendingSettings('org-1', { sendingPaused: false, guardrailBlockedPhrases: [' Cheapest ', 'cheapest', ''] })
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { sendingPaused: false, pausedReason: null, guardrailBlockedPhrases: ['cheapest'] },
    }))
  })

  it('manual pause records a reason', async () => {
    await updateSendingSettings('org-1', { sendingPaused: true })
    expect((prisma.organization.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({
      sendingPaused: true,
      pausedReason: 'Paused manually from Settings.',
    })
  })
})
```

- [ ] **Step 2: Implement `sending-settings.ts`**

```ts
import { prisma } from '@/lib/db/prisma'
import { isValidTimezone } from '@/features/messages/send-window'

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsValidationError'
    Object.setPrototypeOf(this, SettingsValidationError.prototype)
  }
}

export interface SendingSettingsDTO {
  timezone: string
  businessHoursStart: number
  businessHoursEnd: number
  sendDays: number[]
  escalationEmail: string | null
  sendingPaused: boolean
  pausedReason: string | null
  guardrailBlockedPhrases: string[]
  guardrailAllowedWords: string[]
  msConnected: boolean
}

export type SendingSettingsPatch = Partial<Omit<SendingSettingsDTO, 'pausedReason' | 'msConnected'>>

const SELECT = {
  timezone: true, businessHoursStart: true, businessHoursEnd: true, sendDays: true, escalationEmail: true,
  sendingPaused: true, pausedReason: true, guardrailBlockedPhrases: true, guardrailAllowedWords: true, msTenantId: true,
} as const

function toDTO(o: { msTenantId: string | null } & Omit<SendingSettingsDTO, 'msConnected'>): SendingSettingsDTO {
  const { msTenantId, ...rest } = o
  return { ...rest, msConnected: !!msTenantId }
}

function cleanList(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean))]
}

export async function getSendingSettings(organizationId: string): Promise<SendingSettingsDTO> {
  return toDTO(await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: SELECT }))
}

export async function updateSendingSettings(organizationId: string, patch: SendingSettingsPatch): Promise<SendingSettingsDTO> {
  const data: Record<string, unknown> = {}

  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) throw new SettingsValidationError('Unknown timezone')
    data.timezone = patch.timezone
  }
  if (patch.businessHoursStart !== undefined || patch.businessHoursEnd !== undefined) {
    // Validate against the stored value for whichever side isn't being changed.
    const current = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { businessHoursStart: true, businessHoursEnd: true },
    })
    const start = patch.businessHoursStart ?? current.businessHoursStart
    const end = patch.businessHoursEnd ?? current.businessHoursEnd
    const valid = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 24 && start < end
    if (!valid) throw new SettingsValidationError('Business hours must be whole hours with start before end (0–24)')
    if (patch.businessHoursStart !== undefined) data.businessHoursStart = start
    if (patch.businessHoursEnd !== undefined) data.businessHoursEnd = end
  }
  if (patch.sendDays !== undefined) {
    const days = [...new Set(patch.sendDays)].sort()
    if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new SettingsValidationError('Pick at least one send day (0=Sun … 6=Sat)')
    }
    data.sendDays = days
  }
  if (patch.escalationEmail !== undefined) {
    const email = patch.escalationEmail?.trim() || null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SettingsValidationError('Invalid escalation email')
    data.escalationEmail = email
  }
  if (patch.sendingPaused !== undefined) {
    data.sendingPaused = patch.sendingPaused
    data.pausedReason = patch.sendingPaused ? 'Paused manually from Settings.' : null
  }
  if (patch.guardrailBlockedPhrases !== undefined) data.guardrailBlockedPhrases = cleanList(patch.guardrailBlockedPhrases)
  if (patch.guardrailAllowedWords !== undefined) data.guardrailAllowedWords = cleanList(patch.guardrailAllowedWords)

  return toDTO(await prisma.organization.update({ where: { id: organizationId }, data, select: SELECT }))
}
```

In the test file's `beforeEach`, add
`;(prisma.organization.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(row)`
so the hours validation can read the stored values.

Run: `npx vitest run src/features/settings`
Expected: PASS.

- [ ] **Step 3: Write the API route**

`src/app/api/settings/sending/route.ts`:
- `GET` returns `getSendingSettings(org.id)`.
- `PATCH` parses JSON (400 on invalid), picks only the known keys with
  `typeof` checks (strings, numbers, boolean, and string/number arrays;
  anything else returns 400), calls `updateSendingSettings`, and maps
  `SettingsValidationError` to 400 `{ error: message }`.
- Use the same auth and org pattern as `src/app/api/mailboxes/route.ts`.

- [ ] **Step 4: Write the UI components**

Both are client components using the existing `Input`/`Button` from
`@/components/ui` and the CSS variables used in `settings-client.tsx`.

`microsoft-card.tsx` (`'use client'`), with props
`{ connected: boolean; mailboxEmails: string[] }`:
- **Not connected:** explanatory text ("Connect the Microsoft 365 account that
  holds your sending domains. You must be its Global Admin.") and a
  `<a href="/api/integrations/microsoft/connect">` styled as a button labelled
  "Connect Microsoft 365".
- **Connected:**
  - a "Connected" badge
  - a "Load mailboxes" button that fetches `/api/integrations/microsoft/users`
  - a checkbox list of returned users (email and display name)
  - an "Import selected" button that POSTs `{ users }` to
    `/api/integrations/microsoft/mailboxes`, then calls `router.refresh()`
  - an inline error message on a non-OK response
- Read `?microsoft=` from `useSearchParams()` and show these messages:
  - `connected` → "Microsoft 365 connected."
  - `denied` → "Admin consent was not granted."
  - `state_mismatch` → "Connection expired — try again."
  - `error` → "Something went wrong saving the connection."

`sending-settings-form.tsx` (`'use client'`), with props
`{ initial: SendingSettingsDTO }`:
- **Escalation email:** an email input (required to receive reply alerts).
- **Timezone:** a `<select>` of US zones — `America/New_York`,
  `America/Chicago`, `America/Denver`, `America/Phoenix`,
  `America/Los_Angeles`, `America/Anchorage`, `Pacific/Honolulu` — plus the
  current value if it's not in the list.
- **Hours:** start and end number inputs (0–24).
- **Send days:** seven day toggles, Sun–Sat.
- **Guardrails:** "Blocked phrases" and "Always-allowed words" textareas, one
  entry per line.
- A Save button that PATCHes `/api/settings/sending` and shows the server
  error text on 400.
- A separate "Pause all sending" / "Resume sending" button that PATCHes
  `{ sendingPaused: !current }` immediately and shows `pausedReason` when
  paused.

`sending-settings-form.test.tsx` (jsdom):
1. Renders the initial escalation email.
2. Clicking "Pause all sending" calls `fetch('/api/settings/sending', { method: 'PATCH', body: '{"sendingPaused":true}' … })`
   (`vi.stubGlobal('fetch', …)` returning the updated DTO) and then shows
   "Resume sending".
3. A 400 response shows its `error` text.

- [ ] **Step 5: Wire the settings page**

In `page.tsx`, also load `getSendingSettings(org.id)` and pass
`sendingSettings` to `SettingsClient`.

In `settings-client.tsx`:
1. Add the `sendingSettings: SendingSettingsDTO` prop.
2. Render
   `<MicrosoftCard connected={sendingSettings.msConnected} mailboxEmails={mailboxes.map((m) => m.email)} />`
   and then `<SendingSettingsForm initial={sendingSettings} />` above the
   existing "Sending mailboxes" section.
3. Keep the existing manual add-mailbox form, since it's still used for
   SendGrid.
4. Change the section copy "Outbound emails are sent from the active
   mailbox." to "Outbound emails rotate across active mailboxes."

- [ ] **Step 6: Typecheck, test, and eyeball it**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

Run `npm run dev` and open `/settings`. Check:
1. The Connect button links to Microsoft.
2. Saving invalid hours (17→8) shows the error.
3. Pause/Resume toggles, and the dashboard banner appears when paused on a
   connected org.

- [ ] **Step 7: Commit**

```bash
git add src/features/settings src/app/api/settings src/app/\(dashboard\)/settings
git commit -m "feat(settings): Microsoft 365 connection, sending schedule, escalation email, pause-all"
```

---

### Task 17: Campaign and sequence UI, and Action Center items

**Files:**
- Create: `src/features/campaigns/components/campaign-sending-panel.tsx`
- Test: `src/features/campaigns/components/campaign-sending-panel.test.tsx`
- Create: `src/features/campaigns/components/new-campaign-form.tsx`
- Modify: `src/app/(dashboard)/campaigns/[id]/page.tsx`
- Modify: `src/app/(dashboard)/campaigns/page.tsx`
- Modify: `src/features/campaigns/server/get-campaign-detail.ts` (return
  `autoSend`, `sampleSize`, `sampleApprovedAt`, `sampleCount`)
- Modify: `src/features/sequences/types.ts`,
  `src/features/sequences/server/create-sequence.ts`,
  `src/app/api/sequences/route.ts`,
  `src/features/sequences/components/create-sequence-form.tsx`
  (`personalizationPrompt`)
- Modify: `src/features/actions/types.ts`,
  `src/features/actions/server/get-next-actions.ts`
- Test: `src/features/actions/server/get-next-actions.test.ts` (add cases)

**Interfaces:**
- Consumes: the campaign APIs (Task 11), `BLOCKED`/`FAILED` statuses
  (Task 1), and `guardrailFlags` (Task 10).
- Produces:
  - `ActionType` gains `'FIX_BLOCKED_DRAFT' | 'RETRY_FAILED_SEND'`
  - `<CampaignSendingPanel campaignId autoSend sampleSize sampleApprovedAt sampleCount />`

- [ ] **Step 1: Sequence step `personalizationPrompt`, end to end**

1. **`types.ts`:** add `personalizationPrompt: string | null` to
   `SequenceStepDTO`, and add `personalizationPrompt?: string | null` to
   `CreateSequenceInput.steps` items.
2. **`create-sequence.ts`:** add
   `personalizationPrompt: s.personalizationPrompt?.trim() || null` to the
   step `create` map and `personalizationPrompt: s.personalizationPrompt` to
   the DTO map.
3. **The sequence `GET` step mappers:** update any other mapper that builds
   `SequenceStepDTO` (`grep -rn "winningVariantId:" src/features/sequences/server`)
   to include the field.
4. **`route.ts`:** widen the `steps` cast to include
   `personalizationPrompt?: string | null`.
5. **`create-sequence-form.tsx`:**
   - Add `personalizationPrompt: string` to `StepForm`, defaulting to `''`.
   - Send it in the POST body.
   - Under each step's body textarea, add an `<Input>` with placeholder
     `AI line guidance (optional) — e.g. "Mention their property type and city"`
     and helper text: `Put {personalization} in the body where the AI line goes. Merge fields: {firstName|there}, {company}, {title}, or any CSV column.`

Run: `npx vitest run src/features/sequences && npx tsc --noEmit`
Expected: PASS. Update any DTO snapshot or `toEqual` in the sequence tests to
include `personalizationPrompt: null`.

- [ ] **Step 2: Write the failing panel test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { CampaignSendingPanel } from './campaign-sending-panel'

const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

describe('CampaignSendingPanel', () => {
  it('explains the sample gate and approves the sample', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ queued: 8 }), { status: 200 }))
    render(<CampaignSendingPanel campaignId="c1" autoSend sampleSize={10} sampleApprovedAt={null} sampleCount={8} />)
    expect(screen.getByText(/8 of 10 sample drafts ready/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /approve sample & start sending/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/c1/approve-sample', { method: 'POST' }))
    expect(await screen.findByText(/8 emails queued/i)).toBeInTheDocument()
    expect(refresh).toHaveBeenCalled()
  })

  it('shows live status once the sample is approved', () => {
    render(<CampaignSendingPanel campaignId="c1" autoSend sampleSize={10} sampleApprovedAt={new Date('2026-09-20')} sampleCount={10} />)
    expect(screen.getByText(/sending automatically/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve sample/i })).not.toBeInTheDocument()
  })

  it('toggles auto-send via PATCH', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'c1', autoSend: true, sampleSize: 10, sampleApprovedAt: null }), { status: 200 }))
    render(<CampaignSendingPanel campaignId="c1" autoSend={false} sampleSize={10} sampleApprovedAt={null} sampleCount={0} />)
    fireEvent.click(screen.getByRole('switch', { name: /send automatically/i }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/c1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ autoSend: true }) })),
    )
  })
})
```

- [ ] **Step 3: Implement `campaign-sending-panel.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface Props {
  campaignId: string
  autoSend: boolean
  sampleSize: number
  sampleApprovedAt: Date | null
  sampleCount: number
}

export function CampaignSendingPanel({ campaignId, autoSend: initialAutoSend, sampleSize, sampleApprovedAt, sampleCount }: Props) {
  const router = useRouter()
  const [autoSend, setAutoSend] = useState(initialAutoSend)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function toggleAutoSend() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoSend: !autoSend }),
    })
    setBusy(false)
    if (!res.ok) return setError('Could not update auto-send.')
    setAutoSend(!autoSend)
    router.refresh()
  }

  async function approveSample() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/campaigns/${campaignId}/approve-sample`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) return setError('Could not approve the sample.')
    const { queued } = (await res.json()) as { queued: number }
    setMessage(`Sample approved — ${queued} emails queued. New drafts will now send automatically.`)
    router.refresh()
  }

  return (
    <section className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[var(--text-primary)] font-semibold text-sm">Automatic sending</h2>
          <p className="text-[var(--text-muted)] text-xs">Drafts are personalized, checked, and sent during business hours without review.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoSend}
          aria-label="Send automatically"
          disabled={busy}
          onClick={toggleAutoSend}
          className={`relative h-6 w-11 rounded-full transition-colors ${autoSend ? 'bg-[var(--accent-indigo)]' : 'bg-[var(--border-default)]'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${autoSend ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {autoSend && !sampleApprovedAt && (
        <div className="space-y-2">
          <p className="text-[var(--text-secondary)] text-sm">
            {sampleCount} of {sampleSize} sample drafts ready. Review them in Drafts, then approve to start sending.
          </p>
          <Button onClick={approveSample} disabled={busy || sampleCount === 0}>
            Approve sample &amp; start sending
          </Button>
        </div>
      )}

      {autoSend && sampleApprovedAt && (
        <p className="text-[var(--text-secondary)] text-sm">
          Sending automatically since {new Date(sampleApprovedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
        </p>
      )}

      {message && <p className="text-[var(--status-success)] text-sm">{message}</p>}
      {error && <p role="alert" className="text-[var(--status-danger)] text-sm">{error}</p>}
    </section>
  )
}
```

Run: `npx vitest run src/features/campaigns/components/campaign-sending-panel.test.tsx`
Expected: PASS.

- [ ] **Step 4: Campaign pages**

1. **`get-campaign-detail.ts`:**
   - Add `autoSend`, `sampleSize`, and `sampleApprovedAt` to the campaign
     select and returned DTO.
   - Add `sampleCount: await prisma.draft.count({ where: { campaignId, isSample: true, status: { in: ['PENDING_REVIEW', 'APPROVED'] } } })`.
   - Update its test's expected object.
2. **`campaigns/[id]/page.tsx`:** render `<CampaignSendingPanel … />` above
   `DraftsSection`, passing those fields.
3. **`new-campaign-form.tsx`** (`'use client'`): a name input and a Create
   button. It POSTs `/api/campaigns` and on 201 does
   `router.push(`/campaigns/${id}`)`.
4. **`campaigns/page.tsx`:** render `<NewCampaignForm />` at the top of the
   page body.

- [ ] **Step 5: Action Center items for `BLOCKED` drafts and `FAILED` sends**

In `src/features/actions/types.ts`:
1. Add `'FIX_BLOCKED_DRAFT'` and `'RETRY_FAILED_SEND'` to `ActionType`.
2. Add entries to each `Record`:
   - `ACTION_PRIORITY`: `FIX_BLOCKED_DRAFT: 95`, `RETRY_FAILED_SEND: 85`
   - `ACTION_LABELS`: `'Fix Blocked Draft'`, `'Failed Send'`
   - `ACTION_CTA`: `'Fix'`, `'Review'`
   - `ACTION_HREF`: both `'/drafts'`

Check whether other `Record<ActionType, …>` maps exist with
`grep -rn "Record<ActionType" src` and update them all.

In `get-next-actions.ts`, add two queries to the `Promise.all`:

```ts
    prisma.draft.findMany({
      where: { organizationId, status: 'BLOCKED', ...leadFilter },
      select: {
        id: true, subject: true, createdAt: true, guardrailFlags: true,
        lead: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),

    prisma.outboundMessage.findMany({
      where: { organizationId, status: 'FAILED', ...leadFilter },
      select: {
        id: true, subject: true, lastError: true, updatedAt: true, draftId: true,
        lead: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
```

Destructure them as `blockedDrafts` and `failedSends`, and push actions:

```ts
  for (const draft of blockedDrafts) {
    const flags = Array.isArray(draft.guardrailFlags) ? (draft.guardrailFlags as { rule: string; match: string }[]) : []
    actions.push({
      id: actionId('fix-blocked-draft'),
      type: 'FIX_BLOCKED_DRAFT',
      priority: ACTION_PRIORITY.FIX_BLOCKED_DRAFT,
      label: ACTION_LABELS.FIX_BLOCKED_DRAFT,
      description: `"${draft.subject}" for ${leadContext(draft.lead)}`,
      reason: flags.length ? `Blocked: ${flags.map((f) => `${f.rule.toLowerCase().replace(/_/g, ' ')} (${f.match})`).join(', ')}` : 'Blocked by guardrails',
      leadId: draft.lead.id,
      leadName: leadName(draft.lead),
      draftId: draft.id,
      href: ACTION_HREF.FIX_BLOCKED_DRAFT,
      createdAt: draft.createdAt,
    })
  }

  for (const msg of failedSends) {
    actions.push({
      id: actionId('failed-send'),
      type: 'RETRY_FAILED_SEND',
      priority: ACTION_PRIORITY.RETRY_FAILED_SEND,
      label: ACTION_LABELS.RETRY_FAILED_SEND,
      description: `"${msg.subject}" to ${leadContext(msg.lead)}`,
      reason: `Failed after 3 attempts${msg.lastError ? `: ${msg.lastError.slice(0, 120)}` : ''}`,
      leadId: msg.lead.id,
      leadName: leadName(msg.lead),
      ...(msg.draftId && { draftId: msg.draftId }),
      href: ACTION_HREF.RETRY_FAILED_SEND,
      createdAt: msg.updatedAt,
    })
  }
```

In `get-next-actions.test.ts`:
1. Add `outboundMessage: { findMany: vi.fn() }` to the prisma mock if it's
   absent.
2. Make the existing draft `findMany` mocks return `[]` for the new
   `BLOCKED` call. The simplest approach is
   `mockImplementation(({ where }) => where.status === 'BLOCKED' ? blocked : …)`.
3. Add two tests:
   - a `BLOCKED` draft with flags
     `[{ rule: 'UNFILLED_TOKEN', match: '{firstName}' }]` produces a
     `FIX_BLOCKED_DRAFT` action whose `reason` contains
     `unfilled token ({firstName})`
   - a `FAILED` message produces `RETRY_FAILED_SEND` with the `lastError`
     text

Also handle `BLOCKED` in the Drafts UI. In
`src/app/(dashboard)/drafts/drafts-client.tsx` and its server loader
(`get-drafts.ts`), include `status: { in: ['PENDING_REVIEW', 'BLOCKED'] }` in
the review list. Show a red "Blocked" badge with the joined flag text for
`BLOCKED` drafts. The existing approve/reject buttons work unchanged, because
`reviewDraft` now accepts `BLOCKED` (Task 10).

- [ ] **Step 6: Typecheck, test, and eyeball it**

Run: `npx tsc --noEmit && npm test`
Expected: PASS.

Run `npm run dev` and walk the flow:
1. Create a campaign.
2. Create a sequence with `{personalization}` and a guidance line.
3. Enroll two seeded leads.
4. Toggle auto-send on.
5. Hit the sequence runner locally with
   `curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/sequence-runner`.
6. See the sample drafts in Drafts and the "2 of 10 sample drafts ready"
   panel.
7. Blank a lead's first name, re-run, and see a `BLOCKED` draft in the Action
   Center.

- [ ] **Step 7: Commit**

```bash
git add src/features/campaigns src/features/sequences src/features/actions src/features/drafts src/app/\(dashboard\) src/app/api/sequences
git commit -m "feat(ui): campaign auto-send panel, sample approval, AI line guidance, blocked/failed actions"
```

---

### Task 18: Configuration and operations docs

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add the new environment variables to `.env.example`**

Add after the SendGrid block:

```bash
# ── Microsoft 365 (sending tenant) ────────────────────────────
# Azure app registration in the SENDING tenant (Entra ID → App registrations).
# Application permissions (admin-consented): Mail.Send, Mail.ReadWrite, User.Read.All.
MS_GRAPH_CLIENT_ID=
# Client secret VALUE (not the secret ID). Expires — calendar the renewal date;
# an expired secret pauses all sending and emails the escalation address.
MS_GRAPH_CLIENT_SECRET=
# Shared mailbox (no license) that sends reply alerts, e.g. alerts@yoursendingdomain.com.
MS_NOTIFY_MAILBOX=

# ── Scheduler ─────────────────────────────────────────────────
# Shared secret for /api/cron/*. cron-job.org sends "Authorization: Bearer <this>";
# Vercel's own cron sends it automatically when set in the project.
CRON_SECRET=
```

- [ ] **Step 2: Add a "Microsoft 365 sending setup" section to `README.md`**

Copy the nine steps of "Operational setup" from the spec verbatim, and expand
three of them with concrete detail.

**Step 7, app registration:**
- Redirect URI: `https://<app>/api/integrations/microsoft/callback` (Web).
- Application permissions: `Mail.Send`, `Mail.ReadWrite`, `User.Read.All`.
- Grant admin consent.
- Create a mail-enabled security group "Sending Mailboxes" containing the
  sending mailboxes and the alerts shared mailbox.
- In Exchange Online PowerShell, run:
  `New-ApplicationAccessPolicy -AppId <MS_GRAPH_CLIENT_ID> -PolicyScopeGroupId sending-mailboxes@<domain> -AccessRight RestrictAccess -Description "OutboundOS"`.
- Verify it with:
  `Test-ApplicationAccessPolicy -Identity mike@<domain> -AppId <MS_GRAPH_CLIENT_ID>`.

**Step 8, cron-job.org:** three jobs, every 5 minutes, method `GET`, header
`Authorization: Bearer <CRON_SECRET>`:
- `https://<app>/api/cron/sequence-runner`
- `https://<app>/api/cron/send-queue`
- `https://<app>/api/cron/inbox-monitor`

Enable "notify on failure".

**In-app steps:**
1. Settings → Connect Microsoft 365.
2. Load mailboxes → import.
3. Set the escalation email, timezone, and hours.
4. Create a campaign and sequence.
5. Enroll leads.
6. Turn on auto-send.
7. Approve the sample.

Also add a "Writing templates" note covering:
- the `{field|fallback}` syntax
- the `{personalization}` marker
- that guardrails block `$` amounts, "free", and "guarantee" unless they are
  in the template text or allowlisted in Settings

- [ ] **Step 3: Commit**

```bash
git add .env.example README.md
git commit -m "docs: Microsoft 365 sending setup, scheduler, and template syntax"
```

---

### Task 19: Unsubscribe-header spike and manual end-to-end acceptance

This task needs the real sending tenant, so it has no automated tests. It
covers spec Open Risk 1 and the spec's manual acceptance criteria.

- [ ] **Step 1: Spike — does MIME send keep `List-Unsubscribe`?**

Use the connected tenant with a throwaway script at
`scripts/spike-mime-unsubscribe.ts` (don't commit it). It uses
`getGraphToken`, then `POST /users/{mailbox}/sendMail` with
`Content-Type: text/plain` and a base64 MIME body that includes these headers:
- `To: <your Gmail>`
- `Subject: MIME spike`
- `List-Unsubscribe: <https://example.com/u>`
- `List-Unsubscribe-Post: List-Unsubscribe=One-Click`

In Gmail, open "Show original".

- **If both headers are present:** write the finding in the spec's Open Risks
  section and open a follow-up task to switch first-step sends to MIME.
- **If not:** record that the body footer is the final mechanism.

Either way, delete the script.

- [ ] **Step 2: End-to-end run against personal inboxes**

Follow the spec's "Manual acceptance before first real campaign":
1. Connect the tenant and import one mailbox.
2. Set the escalation email to your work address.
3. Create a 3-step sequence with 1-day delays.
4. For the test only, set
   `UPDATE sequence_enrollments SET "nextDueAt" = now()` between steps
   instead of waiting days.
5. Enroll your personal Gmail and Outlook addresses as leads, with auto-send
   on and `sampleSize` 1.

Verify:
- a sample draft appears and approving it queues and sends within one
  send-queue tick during business hours
- step 2 arrives in the same thread as "Re: …"
- a message queued outside business hours waits until the window opens
- replying from Gmail stops the enrollment, cancels the queued step 3, and
  delivers a "[Reply – …]" email to the work address within ~10 minutes
- answering from the sending mailbox in Outlook sets `handledAt` on the next
  monitor tick
- sending to a nonexistent address produces a `BOUNCED` event and a bounced
  lead
- stopping the cron-job.org jobs for over 30 minutes shows the dashboard
  banner

- [ ] **Step 3: Record results**

Append a short "Acceptance results — <date>" section to the spec. List each
check above as pass or fail, with notes. Commit.

```bash
git add docs/superpowers/specs/2026-09-23-microsoft365-autosend-design.md
git commit -m "docs: record MIME unsubscribe spike and end-to-end acceptance results"
```
