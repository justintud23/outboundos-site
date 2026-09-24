# Deliverability Suite (Round 1) — Design

**Date:** 2026-09-24
**Status:** Draft — awaiting review
**Scope:** Round 1 of the deliverability suite: domain health check, ramp controls, deliverability dashboard.

## Context

OutboundOS sends cold email automatically through Microsoft 365 mailboxes on newly purchased sending domains (see `2026-09-23-microsoft365-autosend-design.md`). The product will also be offered to other companies, so this suite is both an internal safeguard and a customer-facing feature.

### Why this approach

Commercial "warmup networks" automatically open, reply to, and rescue each other's mail from spam to fool spam filters. Google Workspace's acceptable use policy prohibits using its services to "evade filtering capabilities". That kind of fake engagement is what gets networks and accounts suspended, and we won't build it.

In this app, warmup means careful, real sending: a slow volume ramp on correctly authenticated domains, bounce and complaint monitoring, and clear visibility.

### What already exists

- A per-mailbox volume ramp (`src/features/mailboxes/warmup.ts`). It reaches the imported mailboxes' 30/day cap on day 3, which is too fast for new domains, and it can't be configured.
- A bounce/complaint circuit breaker (`breaker.ts`, `evaluate-mailbox-breaker.ts`) that auto-pauses a mailbox.
- Per-mailbox `dailyLimit` and atomic daily slot reservation, used by the send queue and by manual Send.
- CAN-SPAM postal address and CASL Canada gates (PR #7).

### Decisions made during brainstorming

| Question | Decision |
|---|---|
| Round 1 pieces | Domain health check, ramp controls, dashboard. List verification and placement tests come in round 2 (paid services). |
| Ramp policy | Per-mailbox presets (Conservative / Standard / Aggressive), default Conservative, plus a young-domain rule based on registration date |
| Failing domain health | Block sending on SPF / DKIM / MX failure. DMARC only warns. |
| Architecture | Checks run on a schedule and are stored. Dashboard metrics are computed when the page loads. No rollup tables. |

### Success criteria

1. A new mailbox on a new domain sends at most 3/day in its first days and reaches the 30/day cap only after about 4 weeks (Conservative).
2. No mail is sent from a mailbox whose domain fails SPF, DKIM, or MX, or has never been checked successfully.
3. The user can see, for every domain and mailbox, what is wrong, how to fix it, and when it will be ready, without leaving the app.
4. The user is emailed once when a domain starts failing and once when it recovers.
5. Existing mailboxes keep their current ramp position. Mailboxes with the ramp turned off keep their full cap.

## Scope

### In scope

- Ramp presets and a new ramp function, including the young-domain rule and the readiness rule.
- A domain health model and checker (DNS + RDAP), a scheduler, on-demand recheck, and an alert on status change.
- Enforcement of domain health in the send queue, mailbox assignment, and manual Send.
- A deliverability dashboard page with a summary, domains table, mailboxes table, and 14-day trend.
- API routes for the dashboard: recheck, set registration date, set preset, restart ramp.

### Out of scope

- List verification and inbox placement tests (round 2; paid providers).
- Fake engagement of any kind (automated opens, replies, spam rescue). Excluded permanently.
- Google Postmaster Tools and Microsoft SNDS integration. SNDS is IP-based and Microsoft 365 shares IPs; Postmaster shows no data at this volume.
- Blocklist (Spamhaus DBL) lookups. Commercial use needs a Spamhaus DQS key; revisit in round 2.
- Nightly rollup tables. They can be added later without changing the dashboard.
- Non-Microsoft-365 mailboxes. The checks assume Microsoft 365 records.

## Design

### 1. Ramp

**Data.** `Mailbox` gains `rampPreset` (enum `RampPreset`: `CONSERVATIVE | STANDARD | AGGRESSIVE`, default `CONSERVATIVE`).

- `warmupEnabled` keeps its meaning: off means full `dailyLimit` immediately.
- `warmupStartedAt` remains ramp day 1.

**Schedule.** Each value is a per-day cap, always `min(cap, dailyLimit)`.

| Ramp day | Conservative | Standard | Aggressive |
|---|---|---|---|
| 1–3 | 3 | 5 | 10 |
| 4–7 | 5 | 10 | 18 |
| 8–14 | 10 | 18 | 25 |
| 15–21 | 18 | 25 | full |
| 22–28 | 25 | full | full |
| 29+ | full | full | full |

The ramp reaches full on day 29 (Conservative), day 22 (Standard), or day 15 (Aggressive).

**Young-domain rule.** While the mailbox's domain was registered less than 30 days ago, today's limit is `min(presetLimit, 10)`. A domain whose registration date is unknown counts as young until a date is recorded, either from RDAP or entered by the user.

**Function.** `effectiveDailyLimit(mailbox, now, domain?)` in `warmup.ts` replaces the fixed `WARMUP_RAMP_PER_DAY` table.

- `domain` is `{ registeredAt: Date | null } | null`.
- When `domain` is null, the young-domain rule is skipped. This keeps SendGrid and legacy mailboxes working.
- The existing callers pass the domain row:
  - `send-draft.ts` (reservation)
  - `process-send-queue.ts` (reservation + pacing)
  - `toMailboxDTO`
- `warmupDay`, `isWarmingUp` and `WARMUP_DAYS` are updated to match.

**Actions.**

- Changing the preset keeps the ramp day.
- **Restart ramp** sets `warmupStartedAt = now`.

**Readiness (advisory, never blocks).** A mailbox is `READY` when all of these hold:

- the ramp is off, or the preset limit for today is `full`
- the young-domain rule no longer applies
- the domain status is `HEALTHY` or `WARNING`
- the mailbox is not auto-paused and is active
- the 14-day bounce rate is under 2% (evaluated only once there are 20 or more sends in 14 days)

Otherwise the mailbox state is one of:

- `RAMPING`, with the estimated ready date = the day the preset reaches full, or the domain's 30th day if later
- `PAUSED`, with the reason
- `BLOCKED`, when the domain is failing or unverified
- `NEEDS_ATTENTION`, when the bounce rate is ≥ 2%

### 2. Domain health

**Data.** New model `DomainHealth`:

| Field | Type / notes |
|---|---|
| `id` | |
| `organizationId` | |
| `domain` | lower-case; `@@unique([organizationId, domain])` |
| `status` | enum `DomainStatus`: `UNVERIFIED \| HEALTHY \| WARNING \| FAILING` |
| `checks` | Json; per-record results, see below |
| `registeredAt` | DateTime? |
| `registeredAtSource` | `'rdap' \| 'manual' \| null` |
| `lastCheckedAt` | DateTime? — last check that produced a result |
| `lastAttemptAt` | DateTime? |
| `lastStatusChangeAt` | DateTime? |
| `lastError` | String? — "couldn't check" detail |
| `alertedStatus` | DomainStatus? — status we last alerted about |

**Which domains.** The distinct domains of the org's `MICROSOFT_GRAPH` mailboxes. A row is created (`UNVERIFIED`) when mailboxes are imported and checked immediately.

**Checks.** A pure `evaluateDomain(records)` over looked-up records, with lookups isolated in a `lookupDomainRecords(domain)` module (`node:dns/promises`, 5-second timeout per query) so the rules are testable with recorded fixtures.

| Record | Pass | Fail (blocks) | Warning |
|---|---|---|---|
| SPF (TXT on domain) | exactly one `v=spf1` record, includes `include:spf.protection.outlook.com`, ends `~all` or `-all` | none, more than one, or no Microsoft 365 include, or `+all` | ends `?all` |
| DKIM (CNAME `selector1._domainkey`, `selector2._domainkey`) | both resolve to a Microsoft target (`*.onmicrosoft.com` or `*.dkim.mail.microsoft`) | either missing or pointing elsewhere | — |
| MX | at least one MX, all ending `.mail.protection.outlook.com` | missing, or any MX elsewhere | — |
| DMARC (TXT `_dmarc.domain`) | `v=DMARC1` with `p=quarantine` or `p=reject` | never | missing → warning; `p=none` → note (shown as info, status unaffected) |

Each check result is `{ record, result: 'pass' | 'fail' | 'warn' | 'info', found: string | null, fix: string | null }`. `fix` holds the exact record to add. For DKIM it also says: "Then enable DKIM for the domain in Microsoft Defender → Email authentication → DKIM."

**Status.**

- `FAILING` if any record fails.
- Otherwise `WARNING` if any record warns.
- Otherwise `HEALTHY`.

**Lookup errors.** Timeouts and SERVFAIL are not failures:

- Keep the previous `status` and `checks`, and set `lastError` ("Couldn't check DNS").
- A domain never successfully checked stays `UNVERIFIED`.
- `NXDOMAIN` / `NODATA` are real answers; for example, no MX means the MX check fails.

**Registration date.** Looked up once via RDAP (`https://rdap.org/domain/<domain>`; event `eventAction: "registration"`, 10-second timeout). Retried on each daily run while it is null. It can be set manually from the dashboard, which overrides RDAP.

**When checks run.**

- On mailbox import (for new domains).
- Daily, from the existing Vercel cron. `vercel.json` changes `heartbeat-check` to run every day (`0 16 * * *`), still one cron. The route calls `refreshAllDomains()` within a 25-second budget, oldest `lastAttemptAt` first.
- On demand, via `POST /api/deliverability/domains/[id]/recheck`: org-scoped, rate-limited to one check per domain per 60 seconds (checked against `lastAttemptAt`, returning 429).

**Alerts.** After each check, if `status` changed to `FAILING` and `alertedStatus !== 'FAILING'`, call `sendOrgAlert(org, "Domain <d> is failing: sending paused", <fixes>)`. On recovery from `FAILING` to `HEALTHY`/`WARNING`, send one "recovered" alert. Store `alertedStatus` so a daily recheck of an unchanged failure does not re-alert. A failed alert (returns false) leaves `alertedStatus` unchanged, so it retries on the next check.

**Enforcement.** A mailbox's domain is usable when its `DomainHealth.status` is `HEALTHY` or `WARNING`. `FAILING`, `UNVERIFIED`, or no row are not usable.

| Path | Behavior |
|---|---|
| `process-send-queue.ts` | Mailboxes on unusable domains are excluded from the mailbox query. Their queued messages stay `QUEUED` and send after recovery. |
| `assign-mailbox.ts` | Mailboxes on unusable domains are never assigned. |
| `send-draft.ts` | Throws `DomainNotHealthyError(domain, status)` → 422 `DOMAIN_NOT_HEALTHY`, with the failing records in the message. |
| SendGrid / non-Graph mailboxes | Unaffected (not checked). |

### 3. Deliverability dashboard

A new page, `/deliverability`, in the sidebar after Analytics (icon `ShieldCheck`). The server page loads everything via `getDeliverabilityOverview(organizationId, now)`.

**Summary row.**

- Domains: healthy / warning / failing / unverified.
- Mailboxes: ready / ramping / paused / blocked / needs attention.
- Today's capacity: the sum of `effectiveDailyLimit` over usable mailboxes, vs. messages `QUEUED` with `scheduledFor` today.
- 14-day totals: sent, bounce rate, reply rate.

**Domains table.** One row per domain:

- SPF / DKIM / MX / DMARC chips
- age (tagged "young" if under 30 days, "unknown" if no date)
- last checked, or "couldn't check" with a time
- a **Recheck now** button
- an expandable row with each check's found value and fix
- a date input to set the registration date (`PATCH /api/deliverability/domains/[id]` `{ registeredAt }`)

**Mailboxes table.** One row per mailbox:

- address
- domain status
- preset dropdown (`PATCH /api/mailboxes/[id]` gains `rampPreset`)
- ramp day, today's limit, sent today
- 14-day sent, bounce %, reply %
- state badge with detail: estimated ready date, pause reason, or blocking domain
- actions: **Restart ramp** (`PATCH /api/mailboxes/[id]` `{ restartRamp: true }`) and the existing Resume

**Trend chart.** Daily sent / bounces / replies for the last 14 days, org-wide or filtered to one mailbox, using the existing chart components.

**Metrics.** Calculated on each page load with grouped queries over existing data:

- Sent: `OutboundMessage.sentAt` within 14 days, grouped by `mailboxId` and day.
- Bounces: `MessageEvent` `BOUNCED` joined to the message's mailbox.
- Replies: `InboundReply` with `mailboxId`, excluding `OUT_OF_OFFICE`.
- Rates: 0 when sent is 0.
- All grouping by day uses the org timezone.

### Error handling

| Failure | Behavior |
|---|---|
| DNS timeout / SERVFAIL | Keep last result; show "couldn't check" + time; `UNVERIFIED` stays blocking |
| RDAP failure / no registration event | `registeredAt` stays null (young until known); retried daily; manual override available |
| Alert send fails | `alertedStatus` unchanged → retried on next check |
| Recheck spam | 429 within 60 s of the last attempt |
| Dashboard query error | Page renders an error state; the rest of the app is unaffected |
| Daily refresh exceeds budget | Stops at 25 s; remaining domains are refreshed the next day (oldest first) |

### Data model changes (one migration)

| Model | Change |
|---|---|
| `enum RampPreset` | New: `CONSERVATIVE`, `STANDARD`, `AGGRESSIVE` |
| `Mailbox` | + `rampPreset RampPreset @default(CONSERVATIVE)` |
| `enum DomainStatus` | New: `UNVERIFIED`, `HEALTHY`, `WARNING`, `FAILING` |
| `DomainHealth` | New model as above; `Organization` gains the relation |

Existing mailboxes get `CONSERVATIVE`. Existing Graph mailboxes' domains need a first check before they can send. The next daily run handles this, and the dashboard shows each `UNVERIFIED` domain with a **Check now** button (the same recheck route) for immediate verification. Page loads never run DNS lookups.

## Testing

- **Ramp:**
  - every preset × day boundary (days 1, 3, 4, 7, 8, 14, 15, 21, 22, 28, 29)
  - `dailyLimit` below a preset step
  - young domain (<30 days, exactly 30, unknown)
  - ramp off
  - null domain (legacy)
  - readiness states and estimated ready date
- **Domain evaluation**, with recorded record fixtures:
  - SPF missing / multiple / no Microsoft 365 include / `?all` / `+all`
  - DKIM one-of-two / wrong target / both Microsoft
  - MX missing / third-party / Microsoft
  - DMARC missing / `p=none` / `p=reject`
  - status aggregation
- **Lookup errors:** timeout keeps the previous result; NXDOMAIN counts as missing; never-checked stays `UNVERIFIED`.
- **Alerts:** exactly one alert on transition to `FAILING`, none on an unchanged daily recheck, one on recovery, retry after a failed send.
- **Enforcement:** the send queue excludes an unusable domain's mailboxes (messages stay `QUEUED`); `assignEnrollmentMailbox` skips them; `sendDraft` throws `DomainNotHealthyError`; non-Graph mailboxes are unaffected.
- **Metrics:** 14-day aggregation with sample rows, org-timezone day bucketing, zero-send rates.
- **Routes:** org scoping, recheck rate limit, registration date validation, preset / restart ramp.
- **UI:** dashboard renders all states; preset change and recheck call the right routes; the error state renders.

## Open risks

1. **DKIM CNAMEs present does not mean DKIM is enabled.** Microsoft 365 signs only after DKIM is enabled in Defender. The fix text says so. A later improvement could send a test message to a seed inbox and read `Authentication-Results`; that belongs with round 2's placement tests.
2. **RDAP coverage.** Some registries (and some ccTLDs) don't expose a registration date via rdap.org. Such domains stay "young" until the user enters a date. That is the safe default.
3. **Vercel Hobby cron limits.** Only daily crons are allowed. Domain checks piggyback on the existing daily job, and on-demand recheck covers urgency.
4. **Existing tenants' first check.** Until the first successful check, Graph mailboxes are blocked. Import checks new domains immediately, the daily run covers the rest, and **Check now** on the dashboard resolves it on demand. The blocked state and the button make this visible, so it can't fail silently.
