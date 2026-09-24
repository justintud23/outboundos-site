# Deliverability Suite (Round 2A) — Design

**Date:** 2026-09-24
**Status:** Draft — awaiting review
**Scope:** Round 2A of the deliverability suite: email list verification and a template content check. Round 2B (blocklist monitoring and inbox placement tests) gets its own spec.

## Context

Round 1 (`2026-09-24-deliverability-suite-design.md`, PR #8) added domain health checks, ramp presets and the Deliverability dashboard. Round 2A adds two gates that stop bad sends before they happen:

- **List verification:** don't email addresses that will bounce.
- **Content check:** don't launch templates that read like spam.

The app is used by a commercial snow removal, salting and paving company. It sends 75–200 cold emails a day through Microsoft 365 to property managers, HOAs and facilities teams. It will also be sold to other companies.

### What already exists

- **Bounce detection:** Microsoft 365 bounce emails (NDRs) are detected by `classify-inbound.ts` and `monitor-mailboxes.ts`, and matched to sent messages by recipient.
- **Bounce circuit breaker:** it auto-pauses a mailbox, and round 1's readiness flags a bounce rate of 2% or more.
- **Per-email guardrails (`src/features/drafts/guardrails.ts`):**
  - They block generated drafts containing `$` amounts, "guarantee", "guaranteed", "free", or org-blocked phrases.
  - Phrases that appear in the approved template are exempt.
- **Auto-send lifecycle:** auto-send is switched on by `updateCampaignSending` (`PATCH /api/campaigns/[id]`). Before that, a sample batch has to be approved.
- **Crons:** cron-job.org calls `/api/cron/sequence-runner`, `send-queue` and `inbox-monitor` every 5 minutes. The sequence runner stops starting new work after 25 s, because cron-job.org times out at about 30 s.

### Decisions made during brainstorming

| Question | Decision |
|---|---|
| Round 2 scope | Split: 2A = verification + content check (this spec); 2B = blocklists + placement tests |
| Verification provider | MillionVerifier (single-address real-time API), behind a provider interface |
| Catch-all / unknown | Send, but flag as risky. An org setting (`blockRiskyEmails`) switches to blocking them. |
| When to verify | On enrollment, in the background. The first email waits for a result. Results are re-checked after 90 days. |
| Content gate | Show Low / Medium / High. Block auto-send only while a step is High, with a recorded override. |

### Success criteria

1. No first email is drafted or sent to a lead whose address verified `invalid` or `disposable`.
2. Leads are verified only when enrolled, so imports cost no credits.
3. A missing key or exhausted credits never lets an unverified lead through when verification is configured. The user is told once.
4. With no `MILLIONVERIFIER_API_KEY` configured, sending behaves exactly as today.
5. A campaign can't start (or keep) auto-sending with a High-risk step unless someone records an override reason, and the override lapses when the content changes.

## Scope

### In scope

- Lead verification fields, a provider interface with a MillionVerifier adapter, and a verification worker inside the sequence runner.
- A verification gate on step 1 of the sequence runner and on manual Send of a lead's first email.
- Bounce feedback: a detected bounce marks the lead `INVALID`.
- The `blockRiskyEmails` org setting.
- A verification badge (Leads table, lead page) and counts on the Deliverability page.
- A pure `checkContent` function, per-step badges in the sequence editor, and a campaign-level worst level.
- A content gate on enabling auto-send and on saving steps/variants of a live campaign, plus the override.

### Out of scope

- Blocklist monitoring and inbox placement tests (round 2B).
- Per-org verification API keys ("bring your own key"). One platform key for now.
- Bulk-file verification, and verifying at import.
- Verifying before follow-ups (only the first email is gated).
- Role-based permissions. The app has no admin role yet, so any org member can record an override, and their user ID is stored. It can be restricted when roles arrive with rep ownership (roadmap item 3).
- Scoring the AI-written personalization line. The per-draft guardrails keep covering it.

## Design

### 1. List verification

**Data (one migration, shared with section 2).**

| Model | Change |
|---|---|
| `enum EmailCheck` | New: `UNCHECKED`, `PENDING`, `OK`, `RISKY`, `INVALID` |
| `Lead` | + `emailCheck EmailCheck @default(UNCHECKED)`, `emailCheckResult String?`, `emailCheckedAt DateTime?`, `emailCheckAttempts Int @default(0)`; + `@@index([emailCheck])` |
| `Organization` | + `blockRiskyEmails Boolean @default(false)`, `verificationAlertedAt DateTime?` |

Existing leads start as `UNCHECKED`.

**Provider interface** (`src/features/verification/provider.ts`):

```ts
type VerifyOutcome =
  | { kind: 'result'; result: 'ok' | 'catch_all' | 'unknown' | 'invalid' | 'disposable' }
  | { kind: 'retry'; reason: string }                 // per-address error/timeout
  | { kind: 'account'; reason: 'no_credits' | 'bad_key' } // stop the whole run

interface EmailVerifier { verify(email: string): Promise<VerifyOutcome> }
```

The MillionVerifier adapter calls `GET https://api.millionverifier.com/api/v3/?api=<key>&email=<email>&timeout=10` with a 15 s client timeout.

- The API's `result` field maps directly.
- `error` becomes `retry`.
- An error response about credits or an invalid key becomes `account`.
- The key comes from `MILLIONVERIFIER_API_KEY`. `getVerifier()` returns `null` when the key is unset.

**Mapping.**

| Provider result | `emailCheck` |
|---|---|
| `ok` | `OK` |
| `catch_all`, `unknown` | `RISKY` |
| `invalid`, `disposable` | `INVALID` |
| `retry` × 3 attempts | `RISKY` (result stored as `unknown`) |

**When a lead becomes `PENDING`.**

- `enrollLead` sets `PENDING` unless the lead's `emailCheck` is `OK`/`RISKY`/`INVALID` with `emailCheckedAt` within the last 90 days.
- Leads already enrolled when this ships are covered by the gate (below): the gate sets `PENDING` the first time they come up for step 1.

**Worker** (`verifyPendingLeads(budgetMs, deps)` in `src/features/verification/server/verify-leads.ts`).

- It runs at the start of the sequence-runner cron with a **10 s budget** inside the runner's existing 25 s budget.
- It takes `PENDING` leads oldest-first (by `updatedAt`), checks 5 at a time, and stops starting new checks once the budget is spent.
- It is skipped entirely when `getVerifier()` is `null`.
- A `result` writes `emailCheck`, `emailCheckResult`, `emailCheckedAt`, and resets `emailCheckAttempts`.
- A `retry` increments `emailCheckAttempts`. At 3 attempts it writes `RISKY`/`unknown`.
- An `account` outcome stops the run immediately and leaves leads `PENDING`. Each affected org is alerted once through `sendOrgAlert`, "Email verification paused: <reason>", claimed atomically on `verificationAlertedAt`. The claim is cleared after the next successful result, so a later outage alerts again.

**The gate** (`verificationGate(lead, org, hasVerifier)` → `'send' | 'wait' | 'stop'`, pure, in `src/features/verification/gate.ts`).

| Condition | Result |
|---|---|
| No verifier configured | `send` (today's behavior) |
| `OK` within 90 days | `send` |
| `RISKY` within 90 days, `blockRiskyEmails` off | `send` |
| `RISKY` within 90 days, `blockRiskyEmails` on | `stop` ("Email is risky (catch-all/unknown) and risky emails are blocked") |
| `INVALID` (any age) | `stop` ("Email failed verification (<result>)") |
| `UNCHECKED`, `PENDING`, or a result older than 90 days | `wait`; the caller sets `PENDING` if the lead isn't already `PENDING` |

The gate applies in two places:

- **Sequence runner, step 1 only** (`runSequenceStep` when `currentStepNumber === 0`), before a draft is generated:
  - `wait` leaves the enrollment `ACTIVE` and pushes `nextDueAt` to now + 10 minutes. It's retried later without filling the runner's 50-per-tick batch, which would starve follow-up steps during a verification outage.
  - `stop` sets the enrollment to `STOPPED` with the gate's reason.
  - Follow-up steps are not gated.
- **Manual Send** (`sendDraft`), when the lead has no previously sent message:
  - `wait` or `stop` throws `EmailNotVerifiedError(state, reason)`, and the send route maps it to 422 `EMAIL_NOT_VERIFIED`.
  - `wait` also sets `PENDING`.
  - With no verifier configured, the gate returns `send`.

**Bounce feedback.** When `monitor-mailboxes.ts` matches a bounce to a lead, it also sets that lead's `emailCheck = INVALID`, `emailCheckResult = 'bounced'` and `emailCheckedAt = now`. A later enrollment is then stopped by the gate.

**Settings.** The Settings sending form gains a toggle: "Block risky emails (catch-all / unknown)". It is stored on `Organization.blockRiskyEmails` via the existing sending-settings route.

**UI.**

- **Leads table and lead page:** a badge for Verified / Risky / Invalid / Verifying / Not checked, with the result and date in a tooltip.
- **Deliverability page:** a "Verification" card with counts of pending, risky and invalid leads among enrolled leads. It shows a "Verification not configured" note when there's no key, and a "Verification paused: <reason>" note while an account problem is unresolved.

### 2. Template content check

**Checker** (`checkContent(input)` in `src/features/content-check/check-content.ts`; pure, runs in the client and on the server).

```ts
type ContentInput = { subject: string; body: string; isFirstStep: boolean; blockedPhrases: string[] }
type Finding = { rule: string; severity: 'LOW' | 'MEDIUM' | 'HIGH'; found: string; fix: string }
type ContentResult = { level: 'LOW' | 'MEDIUM' | 'HIGH'; findings: Finding[] }
```

**Rules.**

| Rule id | Condition | Severity |
|---|---|---|
| `fake-reply` | `isFirstStep` and subject starts with `Re:`, `RE:`, `Fwd:`, `FW:` | HIGH |
| `shortener` | Body contains a link on bit.ly, tinyurl.com, t.co, goo.gl, ow.ly, is.gd, buff.ly, rebrand.ly, cutt.ly | HIGH |
| `too-many-links` | 3 or more `http(s)://` or `www.` links in the body | HIGH |
| `blocked-phrase` | The org's blocked phrases, or the guardrail terms (`free`, `guarantee`, `guaranteed`, `$` + digit), whole-word, case-insensitive, in the subject or body | HIGH |
| `two-links` | Exactly 2 links | MEDIUM |
| `html` | `<img`, `<a `, `<table`, `<div`, `<span`, `<font` or `style=` in the body | MEDIUM |
| `trigger-phrase` | Each match from a fixed list (below), case-insensitive | MEDIUM (one finding per phrase) |
| `shouting` | 3 or more words of 4+ letters in all caps (subject + body), `!!`, or emoji in the subject | MEDIUM |
| `long-body` | Body over 200 words, not counting merge fields | MEDIUM |
| `merge-field` | An unclosed `{`, or `{field}` with no `\|fallback`, except `{firstName}`, `{company}` and `{personalization}`, which are always filled | MEDIUM |
| `long-subject` | Subject over 60 characters | LOW |
| `short-body` | Body under 25 words | LOW |

Trigger phrase list: "act now", "limited time", "risk-free", "risk free", "click here", "100%", "no obligation", "buy now", "order now", "special promotion", "exclusive deal", "cash", "winner", "urgent", "once in a lifetime", "double your", "earn money", "lowest price", "best price".

**Level.** The highest severity among the findings. Three or more MEDIUM findings count as HIGH. No findings means LOW.

**What's checked for a campaign.**

- Every step of every sequence: subject and body.
- The first step's active (non-archived) subject variants, each checked against the first step's body.
- Follow-up steps run with `isFirstStep: false`. Their subjects thread as "Re: …" at send time, so `fake-reply` doesn't apply.

**Where it shows.**

- **Sequence editor:** each step shows a Low / Medium / High badge that updates as you type. Expanding it lists each finding and its fix.
- **Campaign page:** shows the worst level across all steps, with a link to the offending step.

**Gate** (`assertContentAllowed(campaignId)` in `src/features/content-check/server/content-gate.ts`).

- It runs when auto-send is being turned on (`updateCampaignSending` with `autoSend: true`).
- It also runs when a step or subject variant is saved on a campaign whose `autoSend` is on. It evaluates the content being saved together with the rest of the campaign's content.
- While any step is HIGH and there's no valid override, it throws `ContentHighRiskError(findingsByStep)`. The routes map it to 422 `CONTENT_HIGH_RISK`, with the findings in the body.

**Override.**

- **Data:** `Campaign` gains `contentOverrideReason String?`, `contentOverrideBy String?` (Clerk user ID), `contentOverrideAt DateTime?` and `contentOverrideHash String?`.
- **Route:** `POST /api/campaigns/[id]/content-override` with `{ reason }`. The reason is required, 10–500 characters, and the route is org-scoped. It stores the four fields, and `contentOverrideHash` is a SHA-256 over the campaign's current steps and active variants in a stable order.
- **Validity:** an override is valid only while the recomputed hash matches. After any edit, a campaign that still scores HIGH needs a fresh override. A campaign that drops to MEDIUM/LOW no longer needs one.
- **UI:** the campaign page shows the override (who, when, reason) whenever it's in effect.

## Error handling

| Failure | Behavior |
|---|---|
| MillionVerifier timeout or `error` result | The lead stays `PENDING`, attempts + 1. After 3 attempts it becomes `RISKY`/`unknown`. |
| Out of credits / bad key | Run stops. Leads stay `PENDING` and step 1 waits. One alert per outage. The Deliverability page shows the reason. |
| `MILLIONVERIFIER_API_KEY` unset | Verification off. Gate returns `send`. The Deliverability page notes it. |
| Worker throws unexpectedly | Caught in the sequence runner and logged. Step processing still runs. |
| Lead enrolled in several sequences | One lead row, one check. Every enrollment reads the same result. |
| Content gate on a campaign with no steps | LOW, so allowed (the sample-approval flow already requires content). |
| Override hash mismatch | Treated as no override. A new 422 names the findings. |

## Testing

- **Provider adapter:**
  - each MillionVerifier response maps to the right outcome (recorded JSON fixtures)
  - HTTP timeout becomes `retry`
  - credit and key errors become `account`
- **Gate:** every row of the gate table, the 90-day boundary, and no verifier configured.
- **Worker:**
  - budget stop
  - concurrency limit
  - `retry` × 3 becomes `RISKY`
  - `account` stops the run and alerts once, including when two runs happen at the same time
  - the alert claim resets after a success
  - skipped when there's no verifier
- **Enrollment:** a fresh result isn't re-queued; a stale or `UNCHECKED` lead becomes `PENDING`.
- **Sequence runner:**
  - step 1 waits on `PENDING` without drafting and moves `nextDueAt` forward 10 minutes
  - waiting step-1 enrollments don't crowd out due follow-ups in the batch
  - step 1 stops on `INVALID`
  - follow-ups are ungated
  - the worker running first means a newly verified lead proceeds in the same tick
- **Manual send:** `EMAIL_NOT_VERIFIED` 422 for a first email; not applied to follow-ups or when no verifier is configured.
- **Bounce feedback:** a matched bounce sets `INVALID`.
- **`checkContent`:** each rule's positive and negative cases, the three-Mediums escalation, a follow-up step not flagged by `fake-reply`, and merge-field fallbacks.
- **Content gate:**
  - enabling auto-send is refused while HIGH
  - saving a HIGH step on a live campaign is refused
  - an override allows it
  - editing after an override (still HIGH) is refused again
  - dropping to MEDIUM needs no override
- **Override route:** org scoping, reason validation.
- **UI:** step badges update as you type; the verification badge renders every state; the Settings toggle saves.

## Open risks

1. **Catch-all share.** If 20–30% of leads are catch-all, `RISKY` sends dominate bounces. The existing bounce breaker and round 1's 2% readiness flag are the backstop. Watch the risky count on the Deliverability page for the first two weeks and turn on `blockRiskyEmails` if bounces climb.
2. **Verification latency.** A newly enrolled lead's first email waits at least one sequence-runner tick (≤5 min), longer during an outage. That's acceptable for cold outreach.
3. **The content rules are heuristics.** They catch common mistakes, not filter behavior. Round 2B's placement tests are the real measure.
4. **The override is not role-restricted yet.** Anyone in the org can override, and their user ID is recorded. Revisit with rep ownership.
