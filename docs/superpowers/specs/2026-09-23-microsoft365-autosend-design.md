# Microsoft 365 Auto-Send & Reply Escalation — Design

**Date:** 2026-09-23
**Status:** Draft — awaiting review
**Sub-project:** 1 of 4 (see Roadmap)

## Context

OutboundOS is being adopted for cold outreach at a commercial snow removal,
salting, and paving company. The goal is to win quoting opportunities from
property managers, HOAs, retail, and facilities buyers.

The company's current outbound email is getting blocked. The fix is to move cold
email off the primary company domain onto several purchased sending domains, each
with a few mailboxes, hosted in a **dedicated Microsoft 365 tenant** that the user
administers.

### What the user asked for

- Emails sent automatically on set sequences with timed follow-ups — no per-email
  approval.
- Volume of 75–200 emails/day.
- 2 reps for sure, possibly 3–5.
- Any reply is escalated to the user, who answers personally.
- Company runs Microsoft Exchange and Salesforce.

### Decisions made during brainstorming

| Question | Decision |
|---|---|
| Sending platform | Microsoft 365 (dedicated sending tenant), via Microsoft Graph |
| Escalation | App notifies the user by email at their work address; user replies natively in Outlook from the sending mailbox (granted Full Access + Send As) |
| AI content latitude | Approved templates + AI-written 1–2 personalized lines per lead |
| Launch guardrail | Each campaign requires a sample batch approval before auto-send begins |
| Scheduler | Stay on Vercel Hobby; external scheduler (cron-job.org) calls cron endpoints every 5 minutes, with a heartbeat monitor |
| Reply detection | Polling via Graph delta queries (not push subscriptions) |
| Timezone | One organization-level timezone and business-hours window |

### Success criteria

1. A campaign, once its sample batch is approved, sends every step of its sequence
   with no human action, spread across mailboxes, within business hours, never
   exceeding each mailbox's warmup/daily allowance.
2. Follow-ups thread under the original email in the recipient's client.
3. A human reply stops the lead's sequence and produces a notification email to the
   user within ~10 minutes of arrival.
4. The user's Outlook reply from the sending mailbox marks the conversation handled.
5. No lead ever receives a duplicate send, and no lead receives a send after they
   replied, bounced, or unsubscribed.
6. If the external scheduler stops, the user is alerted within one business day.

## Scope

### In scope

- Microsoft 365 tenant connection (app-only Graph auth) and mailbox discovery.
- `GraphEmailProvider` implementing the existing `EmailProvider` interface,
  replacing SendGrid as the active provider.
- Automated draft pipeline: template + AI personalization + guardrails + sample
  approval gate.
- Send queue with business-hours scheduling, jitter, per-mailbox capacity, and
  sticky mailbox assignment per enrollment.
- Inbox monitor: replies, bounces (NDRs), out-of-office, unsubscribe requests, and
  "handled" detection from Sent Items.
- Escalation notification email.
- Cron endpoints secured by `CRON_SECRET`, heartbeat table, and stale-scheduler
  alert.
- Organization-wide "Pause all sending" control.

### Out of scope (later sub-projects or deliberately excluded)

- Per-rep ownership of leads/campaigns (sub-project 3).
- Salesforce sync (sub-project 4).
- Industry retargeting of prompts, scoring, and starter sequences (sub-project 2).
- AI-suggested replies / replying inside the app.
- Open and click tracking — tracking pixels hurt deliverability; excluded
  permanently for this deployment.
- Graph push subscriptions.
- Per-lead timezones.
- Peer-to-peer inbox warmup (the existing volume ramp stays; a third-party warmup
  service is an operational recommendation, not app work).
- Removing SendGrid code. It stays in the repo but is not the active provider.

## Roadmap

1. **This spec** — Microsoft 365 auto-send and reply escalation.
2. Industry retargeting — prompts, lead scoring, starter sequences for property
   managers / HOAs / retail / facilities.
3. Rep ownership — leads and campaigns owned by a rep; "Mine" vs "Team" views;
   escalation routed to the owning rep.
4. Salesforce sync — push interested leads to Salesforce; log email activity.

## Architecture

```
cron-job.org (every 5 min)
   │  Authorization: Bearer CRON_SECRET
   ├─► /api/cron/sequence-runner   → due steps → draft pipeline → send queue
   ├─► /api/cron/send-queue        → due QUEUED messages → Graph send
   └─► /api/cron/inbox-monitor     → Graph delta (Inbox, Sent Items) per mailbox

Vercel cron (daily)
   └─► /api/cron/heartbeat-check   → alert if any job is stale
```

Each endpoint does a bounded amount of work per call and records a
`CronHeartbeat` row on completion.

### Components

#### 1. Microsoft 365 connection — `src/lib/email/graph/`

- **Auth:** OAuth 2.0 client-credentials flow against the sending tenant. One
  Azure app registration with **application** permissions `Mail.Send` and
  `Mail.ReadWrite`, plus `User.Read.All` for mailbox discovery. Admin consent is
  granted once.
- **Secrets:** `MS_GRAPH_CLIENT_ID` and `MS_GRAPH_CLIENT_SECRET` live in the
  environment. Only the tenant ID is stored in the database.
- **Tokens:** access tokens are cached in memory per process until shortly before
  expiry. No refresh tokens are stored.
- **Access scoping (setup step, documented):** an Exchange Application Access
  Policy restricts the app to members of a "Sending Mailboxes" mail-enabled
  security group.
- **Connect flow:** a settings screen with an admin-consent link. The callback
  records the tenant ID. The app lists the tenant's users; the user picks which
  mailboxes become `Mailbox` rows.
- **Immutable IDs:** every Graph request sends `Prefer: IdType="ImmutableId"` so
  message IDs survive moves between folders.

#### 2. `GraphEmailProvider` — `src/lib/email/graph/provider.ts`

Implements `EmailProvider`. The interface is extended so callers can thread by
provider reference rather than raw headers:

- `SendEmailInput` gains an optional `replyToProviderMessageId`.
- `SendEmailOutput` gains `providerMessageId` and `conversationId`, alongside the
  existing `sgMessageId`, which becomes nullable and unused for Graph.

**Send behavior:**

- **First step:** `POST /users/{mailbox}/messages` creates a draft. Its ID is
  persisted to `OutboundMessage.graphMessageId` **before** calling
  `POST .../messages/{id}/send`.
- **Follow-ups:** `POST .../messages/{priorGraphMessageId}/createReply`, then
  `PATCH` the body, persist the ID, then `/send`. Exchange sets `In-Reply-To` and
  `References`, and the subject becomes `Re: <root subject>`, matching the
  existing A/B-test convention.
- **Unsubscribe:** see "Open risks" for List-Unsubscribe. The body always
  includes the existing unsubscribe link.

`getEmailProvider()` selects Graph when `MS_GRAPH_CLIENT_ID` is set and falls
back to SendGrid otherwise, so local dev and tests keep working.

#### 3. Draft pipeline — `src/features/sequences/server/run-sequence-step.ts` (extended)

When an enrollment step is due:

1. **Assign a mailbox** if the enrollment has none: the active, non-paused
   mailbox with the most remaining capacity today. It is stored on the
   enrollment and never changes.
2. **Render the template** by substituting merge fields from the lead.
3. **Personalize.** The AI writes 1–2 sentences guided by
   `SequenceStep.personalizationPrompt`, using the lead's fields and
   `customFields`. The output is inserted at a `{personalization}` marker in the
   step body. This reuses the existing data/instruction separation hardening in
   `src/lib/ai`. If the step has no marker or no prompt, no AI call is made.
4. **Run guardrails** (pure function, `src/features/drafts/guardrails.ts`) on
   the rendered subject and body. It checks for:
   - any unfilled `{token}`
   - a currency amount (`$` followed by digits)
   - the words "guarantee", "guaranteed", or "free"
   - any org-configured blocked phrase
   - the AI-written portion being longer than 60 words

   Exemptions: a word on the org's allowlist doesn't trip its rule, and any
   phrase that appears verbatim in the approved step template is exempt.
   Failures set `status = BLOCKED` and record `guardrailFlags`.
5. **Gate:**
   - Campaign `autoSend = false` → `PENDING_REVIEW` (today's behavior).
   - `autoSend = true` and `sampleApprovedAt` null → `PENDING_REVIEW`, marked
     as part of the sample. Once the campaign has `sampleSize` drafts pending,
     further due enrollments are left due and not generated until the sample is
     approved.
   - `autoSend = true` and sample approved → `APPROVED`, with approver `system`
     and an `OutboundMessage` created as `QUEUED` with `scheduledFor` from the
     scheduler.
6. **Approving the sample.** One action in the Drafts UI approves all sample
   drafts and sets `sampleApprovedAt`. Sample drafts are then queued like any
   other.

`BLOCKED` drafts appear in the Action Center with the flags and the options to
edit and approve, or skip. Skipping advances the enrollment.

#### 4. Send queue — `src/features/messages/server/send-queue.ts`, `/api/cron/send-queue`

**Scheduling** (pure function, `src/features/messages/schedule.ts`):

- The window is the org's business hours (default 08:00–17:00, Mon–Fri) in the
  org timezone.
- For a mailbox with daily capacity `C` (min of `dailyLimit` and the warmup
  allowance from `warmup.ts`), the base spacing is `window / C`.
- `scheduledFor` is the later of now and that mailbox's last scheduled time
  plus spacing ± 30% jitter.
- If that falls outside the window, it moves to the next window start plus
  jitter.
- Capacity is counted over messages scheduled for that mailbox on that calendar
  day, so a burst of drafts spills cleanly into following days.

**Sending,** per tick, up to 25 messages:

1. **Select** `QUEUED` messages with `scheduledFor <= now`. The mailbox must be
   active and not auto-paused, and the org must not be paused.
2. **Claim atomically** with the same pattern as the sequence runner (a
   `processing` flag with stale-lock recovery).
3. **Pre-send checks:**
   - If the lead's status is replied, bounced, or unsubscribed, or the
     enrollment is stopped → mark the message `CANCELLED` and skip.
   - If the mailbox is at today's capacity → reschedule to the next window.
4. **Duplicate protection.** If `graphMessageId` is already set, a previous
   attempt got at least as far as creating the draft. Fetch that message by
   immutable ID:
   - It's in Sent Items → mark `SENT` without resending.
   - It's still a draft → send it.
5. **Send** via `GraphEmailProvider`, then store `conversationId` and `sentAt`
   and increment the mailbox counters.

#### 5. Inbox monitor — `src/features/inbox/server/monitor.ts`, `/api/cron/inbox-monitor`

For each mailbox, round-robin by oldest `lastPolledAt`, as many as fit in the
time budget:

- **Inbox:** `GET /users/{mb}/mailFolders/inbox/messages/delta` from the stored
  `inboxDeltaLink`. The new delta link is saved after processing.
- **Classify each new message** (pure function `classifyInboundMessage`, tested
  against fixture messages):
  - **Internal:** sender is one of our own mailboxes → ignore.
  - **Bounce / NDR:** detected by the sender (`postmaster@`,
    `MAILER-DAEMON`), an `Undeliverable:` subject, or a delivery-report content
    type. It is matched to the original message through the embedded original
    ID or recipient address. Records a `BOUNCED` `MessageEvent`, sets the lead
    to bounced, stops enrollments, and feeds the circuit breaker (`breaker.ts`).
  - **Auto-reply:** detected by the `Auto-Submitted` header (anything but
    `no`), `X-Auto-Response-Suppress`, or out-of-office patterns. Recorded as
    an `OUT_OF_OFFICE` reply with no notification; the sequence continues.
  - **Human reply:** handled as below.
- **Match a human reply:**
  1. `conversationId` to an `OutboundMessage`.
  2. Otherwise, sender address to a `Lead`.
  3. Otherwise, it's unmatched: record it against the mailbox with a null lead
     and always notify. This requires `InboundReply.leadId` to become
     nullable.
- **For a matched human reply:**
  1. Create an `InboundReply`. `graphMessageId` is unique, so re-processing is
     a no-op.
  2. Stop all of the lead's active enrollments with reason `REPLIED`.
  3. Classify with the existing reply classifier.
  4. `UNSUBSCRIBE_REQUEST` → set the lead to unsubscribed, no notification.
  5. Everything else → send a notification.
- **Sent Items:** a delta on `mailFolders/sentitems`. A sent message whose
  `conversationId` matches an unhandled `InboundReply`, and which is not one of
  our `OutboundMessage.graphMessageId`s, sets `handledAt`.

#### 6. Escalation notification — `src/features/replies/server/notify.ts`

Sent through Graph from a **shared mailbox** in the sending tenant, configured as
`MS_NOTIFY_MAILBOX`. Shared mailboxes need no license and never count against
cold-mailbox limits. The recipient is `Organization.escalationEmail`.

Content:

- **Subject:** `[Reply – POSITIVE] Jane Doe @ Acme Property Mgmt`
- **Body:**
  - lead name, company, title
  - campaign and step
  - classification and confidence
  - the reply text, quoted and trimmed
  - which mailbox to answer from in Outlook
  - a link to the lead in OutboundOS

`notifiedAt` is set on success. Failures retry on the next tick, since the
monitor also sweeps replies with no `notifiedAt`.

#### 7. Heartbeat & controls

- `CronHeartbeat(job, lastRunAt, lastResult)` is upserted at the end of each cron
  endpoint.
- `/api/cron/heartbeat-check` is the daily Vercel cron. The existing
  `vercel.json` entry is repointed from the sequence runner to this endpoint.
  If any job's `lastRunAt` is older than 30 minutes of business-hours time, it
  emails `escalationEmail` and sets a flag that renders a dashboard banner.
- `Organization.sendingPaused` is toggled from the dashboard. When on, the send
  queue and the draft pipeline's auto-queueing skip that org. Monitoring
  continues.

## Data model changes

One Prisma migration. All new columns are nullable or defaulted; existing rows
are unaffected.

**`Organization`**

| Field | Type / default |
|---|---|
| `timezone` | `String`, default `"America/New_York"` |
| `businessHoursStart` | `Int`, default `8` |
| `businessHoursEnd` | `Int`, default `17` |
| `sendDays` | `Int[]`, default Mon–Fri |
| `escalationEmail` | `String?` |
| `sendingPaused` | `Boolean`, default `false` |
| `guardrailBlockedPhrases` | `String[]` |
| `guardrailAllowedWords` | `String[]` |
| `msTenantId` | `String?` |

**`Mailbox`**

| Field | Type / default |
|---|---|
| `provider` | enum `SENDGRID` \| `MICROSOFT_GRAPH`, default `SENDGRID` |
| `graphUserId` | `String?` |
| `inboxDeltaLink` | `String?` |
| `sentDeltaLink` | `String?` |
| `lastPolledAt` | `DateTime?` |

**`Campaign`**

| Field | Type / default |
|---|---|
| `autoSend` | `Boolean`, default `false` |
| `sampleSize` | `Int`, default `10` |
| `sampleApprovedAt` | `DateTime?` |

**`SequenceStep`**

| Field | Type / default |
|---|---|
| `personalizationPrompt` | `String?` |

**`SequenceEnrollment`**

| Field | Type / default |
|---|---|
| `mailboxId` | `String?`, relation to `Mailbox` |

**`Draft`**

| Field | Type / default |
|---|---|
| `DraftStatus` enum | gains `BLOCKED` |
| `guardrailFlags` | `Json?` |
| `isSample` | `Boolean`, default `false` |

**`OutboundMessage`**

| Field | Type / default |
|---|---|
| `MessageStatus` enum | gains `CANCELLED` |
| `scheduledFor` | `DateTime?` |
| `graphMessageId` | `String?`, unique |
| `conversationId` | `String?`, indexed |
| `processing` | `Boolean`, default `false` |
| `processingStartedAt` | `DateTime?` |
| `sendAttempts` | `Int`, default `0` |

**`InboundReply`**

| Field | Type / default |
|---|---|
| `leadId` | becomes nullable |
| `mailboxId` | `String?` |
| `graphMessageId` | `String?`, unique |
| `fromEmail` | `String?` |
| `subject` | `String?` |
| `notifiedAt` | `DateTime?` |
| `handledAt` | `DateTime?` |

**New model `CronHeartbeat`**

| Field | Type |
|---|---|
| `job` | `String`, primary key |
| `lastRunAt` | `DateTime` |
| `lastResult` | `Json?` |

## Error handling

| Failure | Behavior |
|---|---|
| Graph 429 / 503 | Honor `Retry-After`; leave message `QUEUED` with `scheduledFor` pushed out; stop processing that mailbox this tick |
| Graph 401 / 403 (consent revoked, secret expired) | Set `sendingPaused` for the org, email `escalationEmail`, record reason for dashboard |
| Other send error | Increment `sendAttempts`; retry next tick; after 3 → `FAILED` + Action Center item |
| Crash after Graph send, before DB write | Next attempt finds `graphMessageId`, sees it in Sent Items, marks `SENT` — no duplicate |
| AI personalization failure | Enrollment stays due; retried next tick; after 3 consecutive failures → Action Center item |
| Delta link expired (410) | Reset to a fresh delta from 24h ago; `graphMessageId` uniqueness dedupes |
| Notification send failure | `notifiedAt` stays null; retried by the next monitor tick |
| Function time budget | Each endpoint stops starting new work at ~45s and returns; remaining work carries to next tick |
| Scheduler stops | Daily heartbeat check emails the user and shows a banner |

## Testing

Tests use the existing Vitest setup. Graph is mocked at the `fetch` boundary.

**Unit tests (pure functions):**

- Schedule computation: window edges, weekends, jitter bounds, capacity
  rollover, warmup allowance.
- Guardrails: each rule, the allowlist, and template-text exemptions.
- `classifyInboundMessage` against fixture messages captured from real Exchange
  NDRs, out-of-office replies, and human replies.
- Reply matching precedence.

**Provider tests:**

- The `GraphEmailProvider` call sequence for first sends and follow-ups.
- The ID is persisted before `/send`.
- Handling of 429, 401, and 5xx responses.

**Route and integration tests:**

- Each cron endpoint rejects requests without `CRON_SECRET`.
- One full tick against the test database: enrollment due → draft → queued →
  sent → reply ingested → enrollment stopped → notification sent → handled.

**Manual acceptance before first real campaign:**

1. Connect the tenant.
2. Run a 3-step sequence with 1-day delays (temporarily minutes, via a dev-only
   override) to the user's personal Gmail and Outlook addresses.
3. Verify threading, business-hours timing, the notification on reply, and
   `handledAt` after answering from Outlook.

## Operational setup (documented in README, not app code)

1. **Buy domains:** 3 lookalike sending domains, e.g. `get<company>.com` and
   `<company>snow.com`. Point each domain's website at the main company site.
2. **Create the tenant:** a new Microsoft 365 tenant, with the domains added
   and verified.
3. **DNS:** SPF, DKIM (enabled in Defender), and DMARC (`p=none` to start) on
   every domain.
4. **Mailboxes:** 2–3 licensed mailboxes per domain, 7 total to start, with
   realistic names and signatures.
5. **Grant access:** give the user Full Access and Send As on every sending
   mailbox so they auto-map in Outlook.
6. **Notifications mailbox:** create the shared mailbox for notifications.
7. **App registration:** register the Azure app, grant admin consent, and set
   the Application Access Policy for the security group.
8. **Scheduler:** cron-job.org jobs for the three endpoints every 5 minutes,
   each with the `Authorization: Bearer <CRON_SECRET>` header.
9. **Warmup:** 2–4 weeks before full volume. The app's warmup ramp starts low
   automatically. A peer-warmup service is recommended during this period.

## Open risks

1. **List-Unsubscribe header via Graph.** Graph's `internetMessageHeaders` only
   accepts `X-` prefixed headers.
   - **Spike:** test whether sending raw MIME content through Graph (MIME
     `sendMail`) preserves `List-Unsubscribe` and `List-Unsubscribe-Post`.
   - **If it does:** the provider switches to MIME send for first steps.
   - **If not:** the in-body unsubscribe link remains. This is acceptable at
     this volume, because the one-click header is mandatory only above 5,000
     messages a day to Gmail.
2. **NDR formats vary** by receiving server. The classifier will miss some
   bounces. Unknown NDR-like messages default to "human reply" and notify the
   user, which fails safe (noisy, not silent).
3. **Deliverability is only partly an app problem.** Domain age, warmup, list
   quality, and content matter more than code. The app enforces volume limits
   and the circuit breaker; list hygiene (verifying emails before import) is
   the user's responsibility for now.
4. **Vercel Hobby limits.** If function duration or invocation limits become a
   problem, move to Vercel Pro. The design needs no change, only the
   `vercel.json` cron schedule.
