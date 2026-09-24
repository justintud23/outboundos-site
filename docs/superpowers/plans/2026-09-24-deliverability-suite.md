# Deliverability Suite (Round 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Slow per-mailbox ramp presets, domain health checks that block sending from misconfigured domains, and a Deliverability dashboard.

**Architecture:**
- **Pure core.** The rules are pure functions: ramp caps, readiness, domain evaluation, and overview aggregation.
- **Isolated I/O.** DNS/RDAP lookups live in small modules that tests can inject.
- **Persistence.** A `DomainHealth` table stores each domain's latest check.
- **Refresh.** The existing daily Vercel cron runs checks, and so do mailbox import and a rate-limited "Recheck now".
- **Enforcement.** Enforcement plugs into the three existing mailbox-selection points: send queue, `assignEnrollmentMailbox`, and `sendDraft`.
- **Dashboard.** A server page that computes 14-day metrics on load.

**Tech Stack:** Next.js 16 App Router, TypeScript strict (`noUncheckedIndexedAccess`), Prisma 7 + Neon Postgres, `node:dns/promises`, RDAP over `fetch`, Vitest + Testing Library, recharts via `src/components/charts/recharts-wrapper.tsx`.

**Spec:** `docs/superpowers/specs/2026-09-24-deliverability-suite-design.md`

### Deliberate deviations from the spec (decided while planning)

1. **"Queued today" means queued for the next 24 hours.** The summary's queued figure counts `QUEUED` messages with `scheduledFor <= now + 24h`, labelled "queued (next 24h)". The spec's "scheduled for today" doesn't match the queue: it paces at send time, so `scheduledFor` means "eligible from", not a planned send time.
2. **The young-domain cap applies even with the ramp off.** This follows the spec's formula `min(presetLimit, 10)`, where `presetLimit` is `dailyLimit` when the ramp is off. Success criterion 5 still holds: existing ramp-off mailboxes are non-Graph (no domain row, so no young-domain rule).

## Global Constraints

**Ramp**

- Ramp caps per day, as `min(cap, dailyLimit)`:

  | Days | Conservative | Standard | Aggressive |
  |---|---|---|---|
  | 1–3 | 3 | 5 | 10 |
  | 4–7 | 5 | 10 | 18 |
  | 8–14 | 10 | 18 | 25 |
  | 15–21 | 18 | 25 | full |
  | 22–28 | 25 | full | full |
  | 29+ | full | full | full |

- Full is reached on day 29 (Conservative), 22 (Standard), 15 (Aggressive).
- The default preset is `CONSERVATIVE`.
- Young-domain rule: registered less than 30 days ago, or registration unknown, means today's limit is `min(limit, 10)`. It applies only when the mailbox has a domain row (Graph mailboxes).

**Readiness (advisory, never blocks)**

- `READY` requires all of: ramp full (or ramp off), not young, domain `HEALTHY`/`WARNING`, active and not paused, and 14-day bounce rate under 2%.
- The bounce rate counts only once there are 20 or more sends.
- Otherwise the state is `PAUSED`, `BLOCKED`, `NEEDS_ATTENTION`, or `RAMPING`.

**Domain status**

- `FAILING` if SPF, DKIM, or MX fails. `WARNING` if anything warns (DMARC missing, SPF `?all`). Otherwise `HEALTHY`.
- DMARC never fails. `p=none` is `info`.
- A usable domain is `HEALTHY` or `WARNING`. `FAILING`, `UNVERIFIED`, or a missing row blocks Graph mailboxes on that domain.

**DNS and RDAP**

- DNS timeout is 5 s per query, 2 tries.
- `ENOTFOUND`/`ENODATA` mean "no record". Any other DNS error means "couldn't check": keep the previous result and set `lastError`.
- RDAP: `https://rdap.org/domain/<domain>`, event `eventAction: "registration"`, 10 s timeout. Any failure gives `null`.

**Refresh schedule and alerts**

- Recheck rate limit: 60 s per domain, against `lastAttemptAt`, returning 429.
- The daily refresh has a 25 s budget and checks the oldest `lastAttemptAt` first. `vercel.json` `heartbeat-check` runs at `0 16 * * *`.
- Alerts: one on the transition to `FAILING` (`alertedStatus` guards repeats), one on recovery. A failed alert send leaves `alertedStatus` unchanged.

**Enforcement and dashboard**

- Queued messages on a blocked domain stay `QUEUED`. They are never cancelled.
- Manual Send on a blocked domain returns 422 `DOMAIN_NOT_HEALTHY`.
- Dashboard metrics cover the last 14 days, bucketed by day in the org timezone. Replies exclude `OUT_OF_OFFICE`. Rates are 0 when there are no sends.

## Review Focus

1. **A domain that has never been checked** (`UNVERIFIED`) must block Graph mailboxes on it, in all three selection paths. It must not silently fall through to "no row = fine". The tests are in Task 6.
2. **A DNS timeout on a previously `HEALTHY` domain** must keep `HEALTHY` and must not alert. A timeout on a never-checked domain must stay `UNVERIFIED`. The tests are in Task 5.
3. **Repeated daily checks of an unchanged `FAILING` domain** send exactly one alert. Recovery sends one. The tests are in Task 5.
4. **Ramp day boundaries** (days 3→4, 7→8, 14→15, 21→22, 28→29), with `dailyLimit` below a preset step. The tests are in Task 2.
5. **Day bucketing near midnight in the org timezone:** a send at 23:30 ET must count on that ET day, not the next UTC day. The tests are in Task 9.

---

## File Structure

**New**

| File | Responsibility |
|---|---|
| `src/features/deliverability/readiness.ts` (+ test) | Pure mailbox state, estimated ready date |
| `src/features/deliverability/evaluate-domain.ts` (+ test) | Pure SPF/DKIM/MX/DMARC rules and status |
| `src/features/deliverability/server/lookup-domain.ts` (+ test) | DNS lookups (injectable resolver) and `DnsLookupError` |
| `src/features/deliverability/server/rdap.ts` (+ test) | Registration date lookup |
| `src/features/deliverability/server/domain-health.ts` (+ test) | Row creation, check-and-persist, alerts, daily refresh, usable-domain map |
| `src/features/deliverability/overview.ts` (+ test) | Pure 14-day aggregation and summary |
| `src/features/deliverability/server/get-overview.ts` | Loader that feeds `overview.ts` |
| `src/features/deliverability/types.ts` | DTOs |
| `src/features/mailboxes/server/set-mailbox-ramp.ts` (+ test) | Set preset, restart ramp |
| `src/app/api/deliverability/domains/[id]/recheck/route.ts` (+ test) | Recheck route |
| `src/app/api/deliverability/domains/[id]/route.ts` (+ test) | PATCH registration date |
| `src/app/(dashboard)/deliverability/page.tsx` | Server page |
| `src/features/deliverability/components/deliverability-client.tsx` (+ test) | The dashboard UI |

**Modified**

- `prisma/schema.prisma` and a new migration
- `src/features/mailboxes/warmup.ts` (+ test rewrite), `src/features/mailboxes/types.ts`
- `src/features/messages/server/process-send-queue.ts` (+ test), `src/features/messages/server/send-draft.ts` (+ test), `src/features/messages/types.ts`
- `src/features/sequences/server/assign-mailbox.ts` (+ test)
- `src/app/api/drafts/[id]/send/route.ts`
- `src/features/integrations/server/microsoft.ts` (+ test)
- `src/app/api/cron/heartbeat-check/route.ts` (+ test), `vercel.json`
- `src/app/api/mailboxes/[id]/route.ts`
- `src/components/layout/sidebar.tsx`
- `README.md`

---

### Task 1: Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260925000000_deliverability_suite/migration.sql` (generated)

**Interfaces:**
- Produces:
  - `enum RampPreset { CONSERVATIVE STANDARD AGGRESSIVE }`
  - `Mailbox.rampPreset`
  - `enum DomainStatus { UNVERIFIED HEALTHY WARNING FAILING }`
  - model `DomainHealth` (fields below)
  - `Organization.domainHealth DomainHealth[]`

- [ ] **Step 1: Edit the schema**

```prisma
enum RampPreset {
  CONSERVATIVE
  STANDARD
  AGGRESSIVE
}

enum DomainStatus {
  UNVERIFIED
  HEALTHY
  WARNING
  FAILING
}
```

In `model Mailbox`, after `warmupStartedAt`:

```prisma
  // Ramp schedule (see features/mailboxes/warmup.ts). Day 1 = warmupStartedAt.
  rampPreset      RampPreset @default(CONSERVATIVE)
```

In `model Organization`, add `domainHealth DomainHealth[]` to the relations.

Add the new model:

```prisma
// Latest DNS/registration check for one sending domain (Graph mailboxes).
model DomainHealth {
  id                 String        @id @default(cuid())
  organizationId     String
  organization       Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  domain             String        // lower-case
  status             DomainStatus  @default(UNVERIFIED)
  checks             Json?         // DomainCheck[] — see features/deliverability/evaluate-domain.ts
  registeredAt       DateTime?
  registeredAtSource String?       // 'rdap' | 'manual'
  lastCheckedAt      DateTime?     // last check that produced a result
  lastAttemptAt      DateTime?     // last attempt, including "couldn't check"
  lastStatusChangeAt DateTime?
  lastError          String?
  alertedStatus      DomainStatus?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  @@unique([organizationId, domain])
  @@index([organizationId])
  @@map("domain_health")
}
```

- [ ] **Step 2: Generate the migration from the dev DB and apply it to dev**

Run:

```bash
set -a; . ./.env; set +a
M=prisma/migrations/20260925000000_deliverability_suite; mkdir -p $M
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > $M/migration.sql
npx prisma migrate deploy && npx prisma generate
```

Expected: the SQL contains only `CREATE TYPE`, `ALTER TABLE … ADD COLUMN`, `CREATE TABLE`, `CREATE INDEX`/`UNIQUE`, and FK. There is no `DROP`. Then "All migrations have been successfully applied."

- [ ] **Step 3: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: clean; all tests pass (no code uses the new fields yet).

- [ ] **Step 4: Commit**

```bash
git add prisma && git commit -m "feat(db): ramp presets and domain health schema"
```

---

### Task 2: Ramp presets and readiness (pure)

**Files:**
- Modify: `src/features/mailboxes/warmup.ts`
- Rewrite: `src/features/mailboxes/warmup.test.ts`
- Create: `src/features/deliverability/readiness.ts`, `src/features/deliverability/readiness.test.ts`

**Interfaces:**
- Produces (warmup.ts):
  - `type RampPresetName = 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE'`
  - `RAMP_STEPS: Record<RampPresetName, { throughDay: number; cap: number }[]>`
  - `rampFullDay(preset): number`
  - `presetCapForDay(preset, day): number` (`Infinity` = full)
  - `YOUNG_DOMAIN_DAYS = 30`, `YOUNG_DOMAIN_CAP = 10`
  - `interface WarmupFields { dailyLimit: number; warmupEnabled: boolean; warmupStartedAt: Date; rampPreset?: RampPresetName }`
  - `interface DomainAge { registeredAt: Date | null }`
  - `isYoungDomain(domain: DomainAge | null | undefined, now): boolean`
  - `warmupDay(start, now)` (unchanged)
  - `effectiveDailyLimit(m, now, domain?: DomainAge | null): number`
  - `isWarmingUp(m, now, domain?)`
- Removed: `WARMUP_RAMP_PER_DAY`, `WARMUP_DAYS`. Only `warmup.test.ts` uses them.
- Produces (readiness.ts):
  - `type MailboxState = 'READY' | 'RAMPING' | 'PAUSED' | 'BLOCKED' | 'NEEDS_ATTENTION'`
  - `type DomainStatusName = 'UNVERIFIED' | 'HEALTHY' | 'WARNING' | 'FAILING'`
  - `isDomainUsable(status: DomainStatusName | null | undefined): boolean`
  - `mailboxReadiness(input: ReadinessInput): { state: MailboxState; readyOn: Date | null; detail: string }`
  - `BOUNCE_RATE_LIMIT = 0.02`, `MIN_SENDS_FOR_BOUNCE_RATE = 20`

- [ ] **Step 1: Replace `warmup.test.ts` with the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { effectiveDailyLimit, warmupDay, isWarmingUp, presetCapForDay, rampFullDay, isYoungDomain } from './warmup'

const NOW = new Date('2026-09-25T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
// Ramp day N ⇔ warmupStartedAt = N-1 days ago.
const onDay = (n: number) => daysAgo(n - 1)
const OLD = { registeredAt: daysAgo(400) }
const mb = (o: Partial<{ dailyLimit: number; warmupEnabled: boolean; warmupStartedAt: Date; rampPreset: 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE' }> = {}) => ({
  dailyLimit: 30, warmupEnabled: true, warmupStartedAt: NOW, rampPreset: 'CONSERVATIVE' as const, ...o,
})

describe('warmupDay', () => {
  it('is day 1 on the start day and counts calendar days', () => {
    expect(warmupDay(NOW, NOW)).toBe(1)
    expect(warmupDay(daysAgo(2), NOW)).toBe(3)
    expect(warmupDay(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(1)
  })
})

describe('presetCapForDay (Review Focus #4: every boundary)', () => {
  it.each([
    ['CONSERVATIVE', [[1, 3], [3, 3], [4, 5], [7, 5], [8, 10], [14, 10], [15, 18], [21, 18], [22, 25], [28, 25], [29, Infinity]]],
    ['STANDARD', [[1, 5], [3, 5], [4, 10], [7, 10], [8, 18], [14, 18], [15, 25], [21, 25], [22, Infinity]]],
    ['AGGRESSIVE', [[1, 10], [3, 10], [4, 18], [7, 18], [8, 25], [14, 25], [15, Infinity]]],
  ] as const)('%s', (preset, pairs) => {
    for (const [day, cap] of pairs) expect(presetCapForDay(preset, day)).toBe(cap)
  })
  it('full on day 29 / 22 / 15', () => {
    expect([rampFullDay('CONSERVATIVE'), rampFullDay('STANDARD'), rampFullDay('AGGRESSIVE')]).toEqual([29, 22, 15])
  })
})

describe('effectiveDailyLimit', () => {
  it('applies the preset cap, never above dailyLimit', () => {
    expect(effectiveDailyLimit(mb({ warmupStartedAt: onDay(1) }), NOW, OLD)).toBe(3)
    expect(effectiveDailyLimit(mb({ warmupStartedAt: onDay(22) }), NOW, OLD)).toBe(25)
    expect(effectiveDailyLimit(mb({ warmupStartedAt: onDay(29) }), NOW, OLD)).toBe(30)
    expect(effectiveDailyLimit(mb({ warmupStartedAt: onDay(15), dailyLimit: 12 }), NOW, OLD)).toBe(12)
  })
  it('defaults to CONSERVATIVE when rampPreset is absent', () => {
    const { rampPreset: _omit, ...legacy } = mb({ warmupStartedAt: onDay(4) })
    expect(effectiveDailyLimit(legacy, NOW, OLD)).toBe(5)
  })
  it('ramp off → full dailyLimit (no domain row → no young rule)', () => {
    expect(effectiveDailyLimit(mb({ warmupEnabled: false }), NOW)).toBe(30)
  })
  it('young domain caps at 10 whatever the preset or ramp setting', () => {
    const young = { registeredAt: daysAgo(10) }
    expect(effectiveDailyLimit(mb({ rampPreset: 'AGGRESSIVE', warmupStartedAt: onDay(20) }), NOW, young)).toBe(10)
    expect(effectiveDailyLimit(mb({ warmupEnabled: false }), NOW, young)).toBe(10)
    expect(effectiveDailyLimit(mb({ warmupStartedAt: onDay(1) }), NOW, young)).toBe(3)
  })
  it('unknown registration date counts as young; exactly 30 days is not young', () => {
    expect(effectiveDailyLimit(mb({ warmupEnabled: false }), NOW, { registeredAt: null })).toBe(10)
    expect(isYoungDomain({ registeredAt: daysAgo(30) }, NOW)).toBe(false)
    expect(isYoungDomain({ registeredAt: daysAgo(29) }, NOW)).toBe(true)
    expect(isYoungDomain(null, NOW)).toBe(false)
  })
  it('isWarmingUp is true while today is below dailyLimit', () => {
    expect(isWarmingUp(mb({ warmupStartedAt: onDay(1) }), NOW, OLD)).toBe(true)
    expect(isWarmingUp(mb({ warmupStartedAt: onDay(40) }), NOW, OLD)).toBe(false)
  })
})
```

`readiness.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mailboxReadiness, isDomainUsable } from './readiness'

const NOW = new Date('2026-09-25T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const base = {
  mailbox: { dailyLimit: 30, warmupEnabled: true, warmupStartedAt: daysAgo(40), rampPreset: 'CONSERVATIVE' as const, isActive: true, autoPaused: false, pauseReason: null },
  domain: { status: 'HEALTHY' as const, registeredAt: daysAgo(400) },
  sent14: 100, bounces14: 1, now: NOW,
}

describe('isDomainUsable', () => {
  it('only HEALTHY and WARNING', () => {
    expect(['HEALTHY', 'WARNING', 'FAILING', 'UNVERIFIED', null].map((s) => isDomainUsable(s as never))).toEqual([true, true, false, false, false])
  })
})

describe('mailboxReadiness', () => {
  it('READY when ramped, old domain, healthy, low bounces', () => {
    expect(mailboxReadiness(base).state).toBe('READY')
  })
  it('PAUSED wins over everything, with the reason', () => {
    const r = mailboxReadiness({ ...base, mailbox: { ...base.mailbox, autoPaused: true, pauseReason: 'Bounce rate 6%' } })
    expect(r).toMatchObject({ state: 'PAUSED', detail: 'Bounce rate 6%' })
  })
  it('BLOCKED when the domain is failing or unverified (or has no row)', () => {
    expect(mailboxReadiness({ ...base, domain: { ...base.domain, status: 'FAILING' } }).state).toBe('BLOCKED')
    expect(mailboxReadiness({ ...base, domain: { ...base.domain, status: 'UNVERIFIED' } }).detail).toMatch(/not verified/i)
    expect(mailboxReadiness({ ...base, domain: null }).state).toBe('BLOCKED')
  })
  it('NEEDS_ATTENTION at ≥2% bounces with ≥20 sends; ignored under 20 sends', () => {
    expect(mailboxReadiness({ ...base, sent14: 50, bounces14: 1 }).state).toBe('NEEDS_ATTENTION')
    expect(mailboxReadiness({ ...base, sent14: 10, bounces14: 3 }).state).toBe('READY')
  })
  it('RAMPING with ready date = the day the preset reaches full', () => {
    const r = mailboxReadiness({ ...base, mailbox: { ...base.mailbox, warmupStartedAt: daysAgo(4) } })
    expect(r.state).toBe('RAMPING')
    // Started 4 days ago = day 5; Conservative full on day 29 → 24 more days.
    expect(r.readyOn?.toISOString().slice(0, 10)).toBe(new Date(NOW.getTime() + 24 * 86_400_000).toISOString().slice(0, 10))
  })
  it('RAMPING until the domain turns 30 days old if that is later', () => {
    const r = mailboxReadiness({ ...base, domain: { status: 'HEALTHY', registeredAt: daysAgo(5) } })
    expect(r.state).toBe('RAMPING')
    expect(r.readyOn?.toISOString().slice(0, 10)).toBe(new Date(daysAgo(5).getTime() + 30 * 86_400_000).toISOString().slice(0, 10))
  })
  it('RAMPING with no date when the domain age is unknown', () => {
    const r = mailboxReadiness({ ...base, domain: { status: 'HEALTHY', registeredAt: null } })
    expect(r).toMatchObject({ state: 'RAMPING', readyOn: null })
    expect(r.detail).toMatch(/domain age unknown/i)
  })
  it('ramp off on an old healthy domain is READY', () => {
    expect(mailboxReadiness({ ...base, mailbox: { ...base.mailbox, warmupEnabled: false, warmupStartedAt: NOW } }).state).toBe('READY')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/features/mailboxes/warmup.test.ts src/features/deliverability/readiness.test.ts`
Expected: FAIL (missing exports / module).

- [ ] **Step 3: Rewrite `warmup.ts`**

```ts
// Mailbox ramp. New mailboxes send a small, slowly rising number of real
// emails per day — careful real sending IS the warmup (no fake engagement).
// Today's limit = the mailbox's preset cap for its ramp day, never above its
// dailyLimit, and never above YOUNG_DOMAIN_CAP while its domain is < 30 days old.

export type RampPresetName = 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE'

// Per-day caps: a step applies through `throughDay` (inclusive); after the last
// step the ramp is complete ("full" = dailyLimit).
export const RAMP_STEPS: Record<RampPresetName, { throughDay: number; cap: number }[]> = {
  CONSERVATIVE: [
    { throughDay: 3, cap: 3 }, { throughDay: 7, cap: 5 }, { throughDay: 14, cap: 10 },
    { throughDay: 21, cap: 18 }, { throughDay: 28, cap: 25 },
  ],
  STANDARD: [
    { throughDay: 3, cap: 5 }, { throughDay: 7, cap: 10 }, { throughDay: 14, cap: 18 }, { throughDay: 21, cap: 25 },
  ],
  AGGRESSIVE: [{ throughDay: 3, cap: 10 }, { throughDay: 7, cap: 18 }, { throughDay: 14, cap: 25 }],
}

export const YOUNG_DOMAIN_DAYS = 30
export const YOUNG_DOMAIN_CAP = 10
const DAY_MS = 86_400_000

export interface WarmupFields {
  dailyLimit: number
  warmupEnabled: boolean
  warmupStartedAt: Date
  rampPreset?: RampPresetName
}

export interface DomainAge {
  registeredAt: Date | null
}

function startOfDay(d: Date): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

/** 1-based ramp day; the calendar day the ramp started is day 1. */
export function warmupDay(warmupStartedAt: Date, now: Date): number {
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(warmupStartedAt).getTime()) / DAY_MS)
  return Math.max(1, days + 1)
}

/** First ramp day on which the preset is at full volume. */
export function rampFullDay(preset: RampPresetName): number {
  const steps = RAMP_STEPS[preset]
  return (steps[steps.length - 1]?.throughDay ?? 0) + 1
}

/** The preset's cap for a ramp day; Infinity once the ramp is complete. */
export function presetCapForDay(preset: RampPresetName, day: number): number {
  return RAMP_STEPS[preset].find((s) => day <= s.throughDay)?.cap ?? Number.POSITIVE_INFINITY
}

/**
 * Young = registered < 30 days ago, or registration unknown. No domain row
 * (non-Graph / legacy mailboxes) → the rule doesn't apply.
 */
export function isYoungDomain(domain: DomainAge | null | undefined, now: Date): boolean {
  if (!domain) return false
  if (!domain.registeredAt) return true
  return now.getTime() - domain.registeredAt.getTime() < YOUNG_DOMAIN_DAYS * DAY_MS
}

export function effectiveDailyLimit(mailbox: WarmupFields, now: Date, domain?: DomainAge | null): number {
  const preset = mailbox.rampPreset ?? 'CONSERVATIVE'
  const rampCap = mailbox.warmupEnabled
    ? presetCapForDay(preset, warmupDay(mailbox.warmupStartedAt, now))
    : Number.POSITIVE_INFINITY
  let limit = Math.min(mailbox.dailyLimit, rampCap)
  if (isYoungDomain(domain, now)) limit = Math.min(limit, YOUNG_DOMAIN_CAP)
  return limit
}

/** True while today's limit is below the mailbox's configured dailyLimit. */
export function isWarmingUp(mailbox: WarmupFields, now: Date, domain?: DomainAge | null): boolean {
  return effectiveDailyLimit(mailbox, now, domain) < mailbox.dailyLimit
}
```

- [ ] **Step 4: Write `readiness.ts`**

```ts
import { isYoungDomain, rampFullDay, warmupDay, YOUNG_DOMAIN_DAYS, type RampPresetName } from '@/features/mailboxes/warmup'

export type MailboxState = 'READY' | 'RAMPING' | 'PAUSED' | 'BLOCKED' | 'NEEDS_ATTENTION'
export type DomainStatusName = 'UNVERIFIED' | 'HEALTHY' | 'WARNING' | 'FAILING'

export const BOUNCE_RATE_LIMIT = 0.02
export const MIN_SENDS_FOR_BOUNCE_RATE = 20
const DAY_MS = 86_400_000

export function isDomainUsable(status: DomainStatusName | null | undefined): boolean {
  return status === 'HEALTHY' || status === 'WARNING'
}

export interface ReadinessInput {
  mailbox: {
    dailyLimit: number
    warmupEnabled: boolean
    warmupStartedAt: Date
    rampPreset: RampPresetName
    isActive: boolean
    autoPaused: boolean
    pauseReason: string | null
  }
  domain: { status: DomainStatusName; registeredAt: Date | null } | null
  sent14: number
  bounces14: number
  now: Date
}

/** Advisory status for the dashboard. Never used to block sending. */
export function mailboxReadiness(i: ReadinessInput): { state: MailboxState; readyOn: Date | null; detail: string } {
  const { mailbox, domain, now } = i

  if (!mailbox.isActive) return { state: 'PAUSED', readyOn: null, detail: 'Turned off' }
  if (mailbox.autoPaused) return { state: 'PAUSED', readyOn: null, detail: mailbox.pauseReason ?? 'Paused automatically' }

  if (!domain || !isDomainUsable(domain.status)) {
    const detail = !domain || domain.status === 'UNVERIFIED'
      ? 'Domain not verified yet — click Check now'
      : 'Domain is failing its DNS checks'
    return { state: 'BLOCKED', readyOn: null, detail }
  }

  if (i.sent14 >= MIN_SENDS_FOR_BOUNCE_RATE && i.bounces14 / i.sent14 >= BOUNCE_RATE_LIMIT) {
    return { state: 'NEEDS_ATTENTION', readyOn: null, detail: `Bounce rate ${((i.bounces14 / i.sent14) * 100).toFixed(1)}% over 14 days` }
  }

  const day = warmupDay(mailbox.warmupStartedAt, now)
  const fullDay = rampFullDay(mailbox.rampPreset)
  const rampDone = !mailbox.warmupEnabled || day >= fullDay
  const young = isYoungDomain(domain, now)
  if (rampDone && !young) return { state: 'READY', readyOn: null, detail: 'Ready for full volume' }

  if (young && !domain.registeredAt) {
    return { state: 'RAMPING', readyOn: null, detail: 'Domain age unknown — set its registration date' }
  }
  const rampReady = rampDone ? now : new Date(now.getTime() + (fullDay - day) * DAY_MS)
  const domainReady = domain.registeredAt ? new Date(domain.registeredAt.getTime() + YOUNG_DOMAIN_DAYS * DAY_MS) : now
  const readyOn = rampReady > domainReady ? rampReady : domainReady
  return { state: 'RAMPING', readyOn, detail: rampDone ? 'New domain (under 30 days)' : `Ramp day ${day} of ${fullDay - 1}` }
}
```

- [ ] **Step 5: Run the tests to see them pass, then typecheck**

Run: `npx vitest run src/features/mailboxes src/features/deliverability && npx tsc --noEmit`
Expected: PASS. `tsc` may flag callers that don't pass a domain; that's fine, because `domain` is optional. If `tsc` flags `WARMUP_*` imports elsewhere, remove them. `grep` showed only the old test used them.

- [ ] **Step 6: Commit**

```bash
git add src/features/mailboxes/warmup.ts src/features/mailboxes/warmup.test.ts src/features/deliverability/readiness*
git commit -m "feat(deliverability): ramp presets, young-domain rule and mailbox readiness"
```

---

### Task 3: Domain evaluation (pure)

**Files:**
- Create: `src/features/deliverability/evaluate-domain.ts`, `src/features/deliverability/evaluate-domain.test.ts`

**Interfaces:**
- Produces:
  - `interface DomainRecords { txt: string[]; dmarc: string[]; mx: string[]; dkim: { selector1: string | null; selector2: string | null } }` (TXT chunks already joined; MX = exchange hostnames)
  - `type CheckResult = 'pass' | 'fail' | 'warn' | 'info'`
  - `interface DomainCheck { record: 'SPF' | 'DKIM' | 'MX' | 'DMARC'; result: CheckResult; found: string | null; fix: string | null }`
  - `evaluateDomain(domain: string, r: DomainRecords): { status: 'HEALTHY' | 'WARNING' | 'FAILING'; checks: DomainCheck[] }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { evaluateDomain, type DomainRecords } from './evaluate-domain'

const D = 'getacmesnow.com'
const good: DomainRecords = {
  txt: ['v=spf1 include:spf.protection.outlook.com -all', 'google-site-verification=abc'],
  dmarc: ['v=DMARC1; p=quarantine; rua=mailto:d@getacmesnow.com'],
  mx: ['getacmesnow-com.mail.protection.outlook.com'],
  dkim: {
    selector1: 'selector1-getacmesnow-com._domainkey.acme.onmicrosoft.com',
    selector2: 'selector2-getacmesnow-com._domainkey.acme.onmicrosoft.com',
  },
}
const check = (r: DomainRecords, rec: string) => evaluateDomain(D, r).checks.find((c) => c.record === rec)!

describe('evaluateDomain', () => {
  it('fully configured → HEALTHY', () => {
    const out = evaluateDomain(D, good)
    expect(out.status).toBe('HEALTHY')
    expect(out.checks.map((c) => [c.record, c.result])).toEqual([['SPF', 'pass'], ['DKIM', 'pass'], ['MX', 'pass'], ['DMARC', 'pass']])
  })

  describe('SPF', () => {
    it('missing → fail with the exact record to add', () => {
      const c = check({ ...good, txt: [] }, 'SPF')
      expect(c.result).toBe('fail')
      expect(c.fix).toContain('v=spf1 include:spf.protection.outlook.com -all')
    })
    it('two SPF records → fail', () => {
      expect(check({ ...good, txt: ['v=spf1 -all', 'v=spf1 include:spf.protection.outlook.com -all'] }, 'SPF').result).toBe('fail')
    })
    it('no Microsoft 365 include → fail', () => {
      expect(check({ ...good, txt: ['v=spf1 include:_spf.google.com ~all'] }, 'SPF').result).toBe('fail')
    })
    it('+all → fail; ?all → warn; ~all → pass', () => {
      expect(check({ ...good, txt: ['v=spf1 include:spf.protection.outlook.com +all'] }, 'SPF').result).toBe('fail')
      expect(check({ ...good, txt: ['v=spf1 include:spf.protection.outlook.com ?all'] }, 'SPF').result).toBe('warn')
      expect(check({ ...good, txt: ['v=spf1 include:spf.protection.outlook.com ~all'] }, 'SPF').result).toBe('pass')
    })
  })

  describe('DKIM', () => {
    it('one selector missing → fail', () => {
      expect(check({ ...good, dkim: { ...good.dkim, selector2: null } }, 'DKIM').result).toBe('fail')
    })
    it('pointing somewhere else → fail', () => {
      expect(check({ ...good, dkim: { selector1: 'x.example.net', selector2: 'y.example.net' } }, 'DKIM').result).toBe('fail')
    })
    it('new-style *.dkim.mail.microsoft targets pass', () => {
      expect(check({ ...good, dkim: { selector1: 'a.dkim.mail.microsoft', selector2: 'b.dkim.mail.microsoft.' } }, 'DKIM').result).toBe('pass')
    })
    it('fix mentions enabling DKIM in Defender', () => {
      expect(check({ ...good, dkim: { selector1: null, selector2: null } }, 'DKIM').fix).toMatch(/Defender/)
    })
  })

  describe('MX', () => {
    it('missing → fail', () => expect(check({ ...good, mx: [] }, 'MX').result).toBe('fail'))
    it('any non-Microsoft MX → fail', () => {
      expect(check({ ...good, mx: [...good.mx, 'mx.backup-host.com'] }, 'MX').result).toBe('fail')
    })
    it('trailing dot tolerated', () => expect(check({ ...good, mx: ['x.mail.protection.outlook.com.'] }, 'MX').result).toBe('pass'))
  })

  describe('DMARC never fails', () => {
    it('missing → warn → WARNING status', () => {
      const out = evaluateDomain(D, { ...good, dmarc: [] })
      expect(out.checks.find((c) => c.record === 'DMARC')?.result).toBe('warn')
      expect(out.status).toBe('WARNING')
    })
    it('p=none → info, status stays HEALTHY', () => {
      const out = evaluateDomain(D, { ...good, dmarc: ['v=DMARC1; p=none'] })
      expect(out.checks.find((c) => c.record === 'DMARC')?.result).toBe('info')
      expect(out.status).toBe('HEALTHY')
    })
    it('p=reject → pass', () => expect(check({ ...good, dmarc: ['v=DMARC1; p=reject'] }, 'DMARC').result).toBe('pass'))
  })

  it('any failure → FAILING even if others warn', () => {
    expect(evaluateDomain(D, { ...good, mx: [], dmarc: [] }).status).toBe('FAILING')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/features/deliverability/evaluate-domain.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// Rules for a Microsoft 365 sending domain. Pure: DNS answers in, verdicts out.
// SPF / DKIM / MX failures block sending; DMARC only warns.

export interface DomainRecords {
  txt: string[] // TXT records on the domain, chunks joined
  dmarc: string[] // TXT records on _dmarc.<domain>
  mx: string[] // MX exchange hostnames
  dkim: { selector1: string | null; selector2: string | null } // CNAME targets
}

export type CheckResult = 'pass' | 'fail' | 'warn' | 'info'

export interface DomainCheck {
  record: 'SPF' | 'DKIM' | 'MX' | 'DMARC'
  result: CheckResult
  found: string | null
  fix: string | null
}

const M365_SPF = 'include:spf.protection.outlook.com'
const M365_DKIM_TARGET = /(\.onmicrosoft\.com|\.dkim\.mail\.microsoft)\.?$/i
const M365_MX = /\.mail\.protection\.outlook\.com\.?$/i

function spfCheck(domain: string, txt: string[]): DomainCheck {
  const spf = txt.filter((t) => /^v=spf1(\s|$)/i.test(t.trim()))
  const add = `Add a TXT record on ${domain}: v=spf1 ${M365_SPF} -all`
  if (spf.length === 0) return { record: 'SPF', result: 'fail', found: null, fix: add }
  if (spf.length > 1) {
    return { record: 'SPF', result: 'fail', found: spf.join(' | '), fix: `Merge your ${spf.length} SPF records into one TXT record (a domain may only have one).` }
  }
  const record = spf[0]!.trim()
  if (!record.toLowerCase().includes(M365_SPF)) {
    return { record: 'SPF', result: 'fail', found: record, fix: `Add "${M365_SPF}" to your SPF record so Microsoft 365 may send for ${domain}.` }
  }
  if (/[+]all\b/i.test(record)) {
    return { record: 'SPF', result: 'fail', found: record, fix: 'Replace "+all" with "-all" — "+all" lets anyone send as your domain.' }
  }
  if (/[-~]all\s*$/i.test(record)) return { record: 'SPF', result: 'pass', found: record, fix: null }
  return { record: 'SPF', result: 'warn', found: record, fix: 'End the SPF record with "-all" (or "~all") instead of "?all" or no "all".' }
}

function dkimCheck(domain: string, dkim: DomainRecords['dkim']): DomainCheck {
  const found = `selector1 → ${dkim.selector1 ?? 'missing'}; selector2 → ${dkim.selector2 ?? 'missing'}`
  const ok = [dkim.selector1, dkim.selector2].every((t) => t !== null && M365_DKIM_TARGET.test(t))
  if (ok) return { record: 'DKIM', result: 'pass', found, fix: null }
  return {
    record: 'DKIM',
    result: 'fail',
    found,
    fix: `In Microsoft Defender → Email & collaboration → Policies → Email authentication settings → DKIM, select ${domain}, add the two CNAME records it shows (selector1._domainkey and selector2._domainkey) to your DNS, then turn on "Sign messages for this domain with DKIM signatures".`,
  }
}

function mxCheck(domain: string, mx: string[]): DomainCheck {
  const fix = `Point ${domain}'s MX record to Microsoft 365 (<your-domain-with-dashes>.mail.protection.outlook.com, priority 0). Microsoft 365 admin center → Settings → Domains → ${domain} shows the exact value.`
  if (mx.length === 0) return { record: 'MX', result: 'fail', found: null, fix }
  const found = mx.join(', ')
  if (mx.every((h) => M365_MX.test(h))) return { record: 'MX', result: 'pass', found, fix: null }
  return { record: 'MX', result: 'fail', found, fix: `${fix} Remove the other MX records — replies sent to them never reach OutboundOS.` }
}

function dmarcCheck(domain: string, dmarc: string[]): DomainCheck {
  const rec = dmarc.find((t) => /^v=DMARC1/i.test(t.trim()))?.trim() ?? null
  if (!rec) {
    return { record: 'DMARC', result: 'warn', found: null, fix: `Add a TXT record on _dmarc.${domain}: v=DMARC1; p=none; rua=mailto:dmarc@${domain}` }
  }
  const policy = /;\s*p=(\w+)/i.exec(rec)?.[1]?.toLowerCase()
  if (policy === 'quarantine' || policy === 'reject') return { record: 'DMARC', result: 'pass', found: rec, fix: null }
  if (policy === 'none') {
    return { record: 'DMARC', result: 'info', found: rec, fix: 'Monitoring only — fine to start. Once reports look clean, change p=none to p=quarantine.' }
  }
  return { record: 'DMARC', result: 'warn', found: rec, fix: 'Your DMARC record has no valid "p=" policy. Use p=none, p=quarantine or p=reject.' }
}

export function evaluateDomain(domain: string, r: DomainRecords): { status: 'HEALTHY' | 'WARNING' | 'FAILING'; checks: DomainCheck[] } {
  const checks = [spfCheck(domain, r.txt), dkimCheck(domain, r.dkim), mxCheck(domain, r.mx), dmarcCheck(domain, r.dmarc)]
  const status = checks.some((c) => c.result === 'fail') ? 'FAILING' : checks.some((c) => c.result === 'warn') ? 'WARNING' : 'HEALTHY'
  return { status, checks }
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/features/deliverability/evaluate-domain.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/deliverability/evaluate-domain*
git commit -m "feat(deliverability): SPF/DKIM/MX/DMARC evaluation for Microsoft 365 domains"
```

---

### Task 4: DNS and RDAP lookups

**Files:**
- Create: `src/features/deliverability/server/lookup-domain.ts` (+ `.test.ts`)
- Create: `src/features/deliverability/server/rdap.ts` (+ `.test.ts`)

**Interfaces:**
- Produces:
  - `class DnsLookupError extends Error { code: string }`
  - `interface DnsResolver { resolveTxt(n): Promise<string[][]>; resolveMx(n): Promise<{ exchange: string; priority: number }[]>; resolveCname(n): Promise<string[]> }`
  - `lookupDomainRecords(domain: string, resolver?: DnsResolver): Promise<DomainRecords>`
  - `fetchRegistrationDate(domain: string, fetchImpl?: typeof fetch): Promise<Date | null>`

- [ ] **Step 1: Write the failing tests**

`lookup-domain.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { lookupDomainRecords, DnsLookupError, type DnsResolver } from './lookup-domain'

const err = (code: string) => Object.assign(new Error(code), { code })

function resolver(over: Partial<DnsResolver> = {}): DnsResolver {
  return {
    resolveTxt: vi.fn(async (n: string) =>
      n.startsWith('_dmarc.') ? [['v=DMARC1; ', 'p=none']] : [['v=spf1 include:spf.protection.outlook.com', ' -all']]),
    resolveMx: vi.fn(async () => [{ exchange: 'X.mail.protection.outlook.com', priority: 0 }]),
    resolveCname: vi.fn(async (n: string) => [`${n.split('.')[0]}.acme.onmicrosoft.com`]),
    ...over,
  }
}

describe('lookupDomainRecords', () => {
  it('joins TXT chunks, lower-cases MX, reads both DKIM selectors', async () => {
    const r = await lookupDomainRecords('acme.com', resolver())
    expect(r).toEqual({
      txt: ['v=spf1 include:spf.protection.outlook.com -all'],
      dmarc: ['v=DMARC1; p=none'],
      mx: ['x.mail.protection.outlook.com'],
      dkim: { selector1: 'selector1.acme.onmicrosoft.com', selector2: 'selector2.acme.onmicrosoft.com' },
    })
  })
  it('ENOTFOUND / ENODATA mean "no record", not an error', async () => {
    const r = await lookupDomainRecords('acme.com', resolver({
      resolveMx: vi.fn(async () => { throw err('ENODATA') }),
      resolveCname: vi.fn(async () => { throw err('ENOTFOUND') }),
    }))
    expect(r.mx).toEqual([])
    expect(r.dkim).toEqual({ selector1: null, selector2: null })
  })
  it('timeouts / SERVFAIL throw DnsLookupError (couldn’t check)', async () => {
    await expect(lookupDomainRecords('acme.com', resolver({ resolveTxt: vi.fn(async () => { throw err('ETIMEOUT') }) })))
      .rejects.toBeInstanceOf(DnsLookupError)
  })
})
```

`rdap.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { fetchRegistrationDate } from './rdap'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('fetchRegistrationDate', () => {
  it('reads the registration event', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { events: [{ eventAction: 'expiration', eventDate: '2027-01-01T00:00:00Z' }, { eventAction: 'registration', eventDate: '2026-09-01T12:00:00Z' }] }))
    expect((await fetchRegistrationDate('Acme.com', f))?.toISOString()).toBe('2026-09-01T12:00:00.000Z')
    expect(f.mock.calls[0][0]).toBe('https://rdap.org/domain/acme.com')
  })
  it.each([
    ['non-200', json(404, {})],
    ['no registration event', json(200, { events: [] })],
    ['bad date', json(200, { events: [{ eventAction: 'registration', eventDate: 'nope' }] })],
  ])('%s → null', async (_n, res) => {
    expect(await fetchRegistrationDate('acme.com', vi.fn().mockResolvedValue(res))).toBeNull()
  })
  it('network failure → null', async () => {
    expect(await fetchRegistrationDate('acme.com', vi.fn().mockRejectedValue(new Error('down')))).toBeNull()
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/features/deliverability/server/lookup-domain.test.ts src/features/deliverability/server/rdap.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`lookup-domain.ts`:

```ts
import { Resolver } from 'node:dns/promises'
import type { DomainRecords } from '../evaluate-domain'

// "No such record" answers are real answers; everything else (timeout,
// SERVFAIL, refused) means we couldn't check and must not count as a failure.
const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA'])

export class DnsLookupError extends Error {
  constructor(public readonly code: string, name: string) {
    super(`DNS lookup for ${name} failed (${code})`)
    this.name = 'DnsLookupError'
    Object.setPrototypeOf(this, DnsLookupError.prototype)
  }
}

export interface DnsResolver {
  resolveTxt(name: string): Promise<string[][]>
  resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>
  resolveCname(name: string): Promise<string[]>
}

function defaultResolver(): DnsResolver {
  return new Resolver({ timeout: 5000, tries: 2 })
}

async function orEmpty<T>(name: string, fn: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? 'EUNKNOWN'
    if (NO_RECORD.has(code)) return empty
    throw new DnsLookupError(code, name)
  }
}

export async function lookupDomainRecords(domain: string, resolver: DnsResolver = defaultResolver()): Promise<DomainRecords> {
  const d = domain.toLowerCase()
  const [txt, dmarc, mx, s1, s2] = await Promise.all([
    orEmpty(d, () => resolver.resolveTxt(d), [] as string[][]),
    orEmpty(`_dmarc.${d}`, () => resolver.resolveTxt(`_dmarc.${d}`), [] as string[][]),
    orEmpty(d, () => resolver.resolveMx(d), [] as { exchange: string; priority: number }[]),
    orEmpty(`selector1._domainkey.${d}`, () => resolver.resolveCname(`selector1._domainkey.${d}`), [] as string[]),
    orEmpty(`selector2._domainkey.${d}`, () => resolver.resolveCname(`selector2._domainkey.${d}`), [] as string[]),
  ])
  return {
    txt: txt.map((chunks) => chunks.join('')),
    dmarc: dmarc.map((chunks) => chunks.join('')),
    mx: mx.map((r) => r.exchange.toLowerCase()),
    dkim: { selector1: s1[0] ?? null, selector2: s2[0] ?? null },
  }
}
```

`rdap.ts`:

```ts
// Domain registration date via RDAP (the registries' public JSON API; rdap.org
// redirects to the right registry). Best-effort: any failure → null, and a null
// date keeps the domain on the young-domain cap until known.
export async function fetchRegistrationDate(domain: string, fetchImpl: typeof fetch = fetch): Promise<Date | null> {
  try {
    const res = await fetchImpl(`https://rdap.org/domain/${domain.toLowerCase()}`, {
      headers: { Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { events?: { eventAction?: string; eventDate?: string }[] }
    const raw = body.events?.find((e) => e.eventAction === 'registration')?.eventDate
    const date = raw ? new Date(raw) : null
    return date && !Number.isNaN(date.getTime()) ? date : null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run to see them pass, then typecheck**

Run: `npx vitest run src/features/deliverability/server && npx tsc --noEmit`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/deliverability/server/lookup-domain* src/features/deliverability/server/rdap*
git commit -m "feat(deliverability): DNS and RDAP lookups"
```

---

### Task 5: Domain health service (persist, alerts, daily refresh)

**Files:**
- Create: `src/features/deliverability/server/domain-health.ts` (+ `.test.ts`)

**Interfaces:**
- Consumes:
  - `evaluateDomain` (Task 3)
  - `lookupDomainRecords`, `DnsLookupError`, `fetchRegistrationDate` (Task 4)
  - `sendOrgAlert` (existing)
- Produces:
  - `domainOf(email: string): string`
  - `ensureDomainRows(organizationId): Promise<{ id: string; domain: string }[]>` — returns rows never attempted
  - `checkDomain(id: string, deps?: CheckDeps): Promise<DomainHealth>`
  - `refreshAllDomains(budgetMs = 25_000, deps?): Promise<{ checked: number; failed: number }>`
  - `getDomainHealthMap(organizationId): Promise<Map<string, { status: DomainStatus; registeredAt: Date | null }>>`
  - `RECHECK_MIN_INTERVAL_MS = 60_000`
  - `type CheckDeps = { lookup?: typeof lookupDomainRecords; rdap?: typeof fetchRegistrationDate; now?: () => Date }`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    mailbox: { findMany: vi.fn() },
    organization: { findMany: vi.fn() },
    domainHealth: { createMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/features/replies/server/notify', () => ({ sendOrgAlert: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { DnsLookupError } from './lookup-domain'
import { checkDomain, ensureDomainRows, refreshAllDomains, getDomainHealthMap, domainOf } from './domain-health'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { mailbox: { findMany: Fn }; organization: { findMany: Fn }; domainHealth: Record<string, Fn> }
const NOW = new Date('2026-09-25T12:00:00Z')
const GOOD = {
  txt: ['v=spf1 include:spf.protection.outlook.com -all'], dmarc: ['v=DMARC1; p=reject'],
  mx: ['a.mail.protection.outlook.com'], dkim: { selector1: 's1.x.onmicrosoft.com', selector2: 's2.x.onmicrosoft.com' },
}
const row = (o: Record<string, unknown> = {}) => ({
  id: 'dh-1', organizationId: 'org-1', domain: 'getacmesnow.com', status: 'UNVERIFIED', checks: null,
  registeredAt: new Date('2026-01-01'), registeredAtSource: 'rdap', lastCheckedAt: null, lastAttemptAt: null,
  lastStatusChangeAt: null, lastError: null, alertedStatus: null, ...o,
})
const deps = (o: Record<string, unknown> = {}) => ({ lookup: vi.fn().mockResolvedValue(GOOD), rdap: vi.fn().mockResolvedValue(null), now: () => NOW, ...o })

// Stateful fake row: findUnique returns it, update merges into it — so status
// and alertedStatus carry over between checks like the real table.
let current: ReturnType<typeof row>
beforeEach(() => {
  vi.resetAllMocks()
  current = row()
  p.domainHealth.findUnique.mockImplementation(async () => current)
  p.domainHealth.update.mockImplementation(async ({ data }: { data: object }) => (current = { ...current, ...data }))
  ;(sendOrgAlert as Fn).mockResolvedValue(true)
})

describe('domainOf', () => {
  it('lower-cased part after @', () => expect(domainOf('Mike@GetAcmeSnow.COM')).toBe('getacmesnow.com'))
})

describe('ensureDomainRows', () => {
  it('creates UNVERIFIED rows for the org’s Graph mailbox domains and returns never-attempted rows', async () => {
    p.mailbox.findMany.mockResolvedValue([{ email: 'a@x.com' }, { email: 'b@X.com' }, { email: 'c@y.com' }])
    p.domainHealth.findMany.mockResolvedValue([{ id: 'dh-x', domain: 'x.com' }])
    const out = await ensureDomainRows('org-1')
    expect(p.mailbox.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', provider: 'MICROSOFT_GRAPH' })
    expect(p.domainHealth.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: 'org-1', domain: 'x.com' }, { organizationId: 'org-1', domain: 'y.com' }],
      skipDuplicates: true,
    })
    expect(out).toEqual([{ id: 'dh-x', domain: 'x.com' }])
  })
})

describe('checkDomain', () => {
  it('stores the evaluation, status change time, and clears lastError', async () => {
    await checkDomain('dh-1', deps())
    expect(p.domainHealth.update.mock.calls[0][0].data).toMatchObject({
      status: 'HEALTHY', lastCheckedAt: NOW, lastAttemptAt: NOW, lastStatusChangeAt: NOW, lastError: null,
    })
  })

  it('looks up the registration date only while unknown, never over a manual date', async () => {
    current = row({ registeredAt: null, registeredAtSource: null })
    const d = deps({ rdap: vi.fn().mockResolvedValue(new Date('2026-09-01')) })
    await checkDomain('dh-1', d)
    expect(p.domainHealth.update.mock.calls[0][0].data).toMatchObject({ registeredAt: new Date('2026-09-01'), registeredAtSource: 'rdap' })

    current = row({ registeredAt: new Date('2026-02-01'), registeredAtSource: 'manual' })
    const d2 = deps()
    await checkDomain('dh-1', d2)
    expect(d2.rdap).not.toHaveBeenCalled()
  })

  it('Review Focus #2: DNS timeout on a HEALTHY domain keeps HEALTHY, records lastError, no alert', async () => {
    current = row({ status: 'HEALTHY', alertedStatus: null })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockRejectedValue(new DnsLookupError('ETIMEOUT', 'x')) }))
    const data = p.domainHealth.update.mock.calls[0][0].data
    expect(data).toMatchObject({ lastAttemptAt: NOW, lastError: expect.stringMatching(/couldn.t check/i) })
    expect(data).not.toHaveProperty('status')
    expect(sendOrgAlert).not.toHaveBeenCalled()
  })

  it('Review Focus #2: a timeout on a never-checked domain leaves it UNVERIFIED', async () => {
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockRejectedValue(new DnsLookupError('ESERVFAIL', 'x')) }))
    expect(p.domainHealth.update.mock.calls[0][0].data).not.toHaveProperty('status')
  })

  it('Review Focus #3: one alert on turning FAILING; none on an unchanged recheck; one on recovery', async () => {
    const failing = { ...GOOD, mx: [] }
    current = row({ status: 'HEALTHY' })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue(failing) }))
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect((sendOrgAlert as Fn).mock.calls[0][1]).toMatch(/getacmesnow\.com is failing/)
    expect((sendOrgAlert as Fn).mock.calls[0][2]).toMatch(/MX/)
    expect(p.domainHealth.update).toHaveBeenLastCalledWith({ where: { id: 'dh-1' }, data: { alertedStatus: 'FAILING' } })

    ;(sendOrgAlert as Fn).mockClear()
    current = row({ status: 'FAILING', alertedStatus: 'FAILING' })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue(failing) }))
    expect(sendOrgAlert).not.toHaveBeenCalled()

    current = row({ status: 'FAILING', alertedStatus: 'FAILING' })
    await checkDomain('dh-1', deps())
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect((sendOrgAlert as Fn).mock.calls[0][1]).toMatch(/recovered/)
  })

  it('a failed alert leaves alertedStatus unchanged so it retries next check', async () => {
    ;(sendOrgAlert as Fn).mockResolvedValue(false)
    current = row({ status: 'HEALTHY' })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue({ ...GOOD, mx: [] }) }))
    expect(p.domainHealth.update).toHaveBeenCalledTimes(1)
  })
})

describe('refreshAllDomains', () => {
  it('ensures rows for connected orgs, then checks oldest attempt first', async () => {
    p.organization.findMany.mockResolvedValue([{ id: 'org-1' }])
    p.mailbox.findMany.mockResolvedValue([])
    p.domainHealth.findMany.mockResolvedValueOnce([]) // ensureDomainRows' never-attempted query
      .mockResolvedValueOnce([{ id: 'dh-1' }, { id: 'dh-2' }])
    const out = await refreshAllDomains(25_000, deps())
    expect(p.domainHealth.findMany.mock.calls[1][0]).toMatchObject({ orderBy: { lastAttemptAt: { sort: 'asc', nulls: 'first' } } })
    expect(out).toEqual({ checked: 2, failed: 0 })
  })
  it('one domain throwing does not stop the rest', async () => {
    p.organization.findMany.mockResolvedValue([])
    p.domainHealth.findMany.mockResolvedValue([{ id: 'dh-1' }, { id: 'dh-2' }])
    p.domainHealth.findUnique.mockRejectedValueOnce(new Error('db blip'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await refreshAllDomains(25_000, deps())).toEqual({ checked: 1, failed: 1 })
  })
})

describe('getDomainHealthMap', () => {
  it('maps domain → status and age', async () => {
    p.domainHealth.findMany.mockResolvedValue([{ domain: 'x.com', status: 'HEALTHY', registeredAt: null }])
    const m = await getDomainHealthMap('org-1')
    expect(m.get('x.com')).toEqual({ status: 'HEALTHY', registeredAt: null })
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/features/deliverability/server/domain-health.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `domain-health.ts`**

```ts
import type { DomainHealth, DomainStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { evaluateDomain, type DomainCheck } from '../evaluate-domain'
import { lookupDomainRecords, DnsLookupError } from './lookup-domain'
import { fetchRegistrationDate } from './rdap'

export const RECHECK_MIN_INTERVAL_MS = 60_000

export type CheckDeps = {
  lookup?: typeof lookupDomainRecords
  rdap?: typeof fetchRegistrationDate
  now?: () => Date
}

export function domainOf(email: string): string {
  return (email.split('@')[1] ?? '').trim().toLowerCase()
}

/** Create UNVERIFIED rows for new Graph mailbox domains; return never-attempted rows. */
export async function ensureDomainRows(organizationId: string): Promise<{ id: string; domain: string }[]> {
  const mailboxes = await prisma.mailbox.findMany({
    where: { organizationId, provider: 'MICROSOFT_GRAPH' },
    select: { email: true },
  })
  const domains = [...new Set(mailboxes.map((m) => domainOf(m.email)).filter(Boolean))]
  if (domains.length > 0) {
    await prisma.domainHealth.createMany({
      data: domains.map((domain) => ({ organizationId, domain })),
      skipDuplicates: true,
    })
  }
  return prisma.domainHealth.findMany({
    where: { organizationId, lastAttemptAt: null },
    select: { id: true, domain: true },
  })
}

function fixesText(checks: DomainCheck[]): string {
  return checks
    .filter((c) => c.result === 'fail')
    .map((c) => `• ${c.record}: ${c.fix ?? 'see the Deliverability page'}`)
    .join('\n')
}

async function maybeAlert(row: DomainHealth): Promise<void> {
  const checks = (row.checks as unknown as DomainCheck[] | null) ?? []
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  if (row.status === 'FAILING' && row.alertedStatus !== 'FAILING') {
    const ok = await sendOrgAlert(
      row.organizationId,
      `Domain ${row.domain} is failing — sending from it is paused`,
      `Mail from ${row.domain} is on hold until these DNS problems are fixed:\n\n${fixesText(checks)}\n\nAfter fixing, click "Recheck now" on ${appUrl}/deliverability. Queued emails will go out once it passes.`,
    )
    if (ok) await prisma.domainHealth.update({ where: { id: row.id }, data: { alertedStatus: 'FAILING' } })
  } else if ((row.status === 'HEALTHY' || row.status === 'WARNING') && row.alertedStatus === 'FAILING') {
    const ok = await sendOrgAlert(
      row.organizationId,
      `Domain ${row.domain} has recovered`,
      `${row.domain} passes its DNS checks again. Sending from its mailboxes has resumed.`,
    )
    if (ok) await prisma.domainHealth.update({ where: { id: row.id }, data: { alertedStatus: row.status } })
  }
}

export async function checkDomain(id: string, deps: CheckDeps = {}): Promise<DomainHealth> {
  const lookup = deps.lookup ?? lookupDomainRecords
  const rdap = deps.rdap ?? fetchRegistrationDate
  const now = (deps.now ?? (() => new Date()))()

  const row = await prisma.domainHealth.findUnique({ where: { id } })
  if (!row) throw new Error(`DomainHealth ${id} not found`)

  // Registration date: look it up only while unknown; a manual date always wins.
  const registration: Prisma.DomainHealthUpdateInput = {}
  if (!row.registeredAt && row.registeredAtSource !== 'manual') {
    const registeredAt = await rdap(row.domain)
    if (registeredAt) Object.assign(registration, { registeredAt, registeredAtSource: 'rdap' })
  }

  let records
  try {
    records = await lookup(row.domain)
  } catch (err) {
    if (!(err instanceof DnsLookupError)) throw err
    // Couldn't check: keep status/checks (UNVERIFIED stays blocking), no alert.
    return prisma.domainHealth.update({
      where: { id },
      data: { ...registration, lastAttemptAt: now, lastError: `Couldn't check DNS (${err.code}). Will retry.` },
    })
  }

  const { status, checks } = evaluateDomain(row.domain, records)
  const updated = await prisma.domainHealth.update({
    where: { id },
    data: {
      ...registration,
      status: status as DomainStatus,
      checks: checks as unknown as Prisma.InputJsonValue,
      lastCheckedAt: now,
      lastAttemptAt: now,
      lastError: null,
      ...(status !== row.status && { lastStatusChangeAt: now }),
    },
  })
  await maybeAlert(updated)
  return updated
}

/** Daily: make sure every connected org's domains have rows, then check oldest first. */
export async function refreshAllDomains(budgetMs = 25_000, deps: CheckDeps = {}): Promise<{ checked: number; failed: number }> {
  const startedAt = Date.now()
  const orgs = await prisma.organization.findMany({ where: { msTenantId: { not: null } }, select: { id: true } })
  for (const org of orgs) await ensureDomainRows(org.id)

  const rows = await prisma.domainHealth.findMany({
    orderBy: { lastAttemptAt: { sort: 'asc', nulls: 'first' } },
    select: { id: true },
  })
  let checked = 0
  let failed = 0
  for (const { id } of rows) {
    if (Date.now() - startedAt > budgetMs) break
    try {
      await checkDomain(id, deps)
      checked++
    } catch (err) {
      failed++
      console.error(`[domain-health] check ${id} failed`, err)
    }
  }
  return { checked, failed }
}

export async function getDomainHealthMap(
  organizationId: string,
): Promise<Map<string, { status: DomainStatus; registeredAt: Date | null }>> {
  const rows = await prisma.domainHealth.findMany({
    where: { organizationId },
    select: { domain: true, status: true, registeredAt: true },
  })
  return new Map(rows.map((r) => [r.domain, { status: r.status, registeredAt: r.registeredAt }]))
}
```

- [ ] **Step 4: Run to see them pass, then typecheck**

Run: `npx vitest run src/features/deliverability && npx tsc --noEmit`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/deliverability/server/domain-health*
git commit -m "feat(deliverability): domain health checks, status-change alerts and daily refresh"
```

---

### Task 6: Enforcement and ramp wiring in the three selection paths

**Files:**
- Modify:
  - `src/features/messages/types.ts`
  - `src/features/messages/server/process-send-queue.ts` (+ test)
  - `src/features/sequences/server/assign-mailbox.ts` (+ test)
  - `src/features/messages/server/send-draft.ts` (+ test)
  - `src/app/api/drafts/[id]/send/route.ts`

**Interfaces:**
- Consumes:
  - `getDomainHealthMap`, `domainOf` (Task 5)
  - `isDomainUsable` (Task 2)
  - `effectiveDailyLimit(m, now, domain)` (Task 2)
- Produces: `class DomainNotHealthyError extends Error { domain: string; status: string }`, which maps to 422 `DOMAIN_NOT_HEALTHY`.

**Rule:** enforcement applies only to orgs with `msTenantId`, since those send only from Graph mailboxes. Non-tenant (SendGrid) paths are unchanged and pass `domain = null` to `effectiveDailyLimit`.

- [ ] **Step 1: Write the failing tests**

In `process-send-queue.test.ts`:
1. Add `domainHealth: { findMany: vi.fn() }` to the prisma mock (`p` type included).
2. In `beforeEach`, set `p.domainHealth.findMany.mockResolvedValue([{ domain: 'getacmesnow.com', status: 'HEALTHY', registeredAt: new Date('2025-01-01') }])`.
3. Append:

```ts
  it('Review Focus #1: a mailbox on an UNVERIFIED or FAILING domain does not send; its message stays QUEUED', async () => {
    for (const status of ['UNVERIFIED', 'FAILING']) {
      vi.clearAllMocks()
      p.domainHealth.findMany.mockResolvedValue([{ domain: 'getacmesnow.com', status, registeredAt: new Date('2025-01-01') }])
      const res = await processSendQueue(NOW)
      expect(res.sent).toBe(0)
      expect(sendEmail).not.toHaveBeenCalled()
      expect(p.outboundMessage.update).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }))
    }
  })

  it('Review Focus #1: a Graph mailbox whose domain has no row is treated as unverified', async () => {
    p.domainHealth.findMany.mockResolvedValue([])
    expect((await processSendQueue(NOW)).sent).toBe(0)
  })

  it('young domain: today’s limit is capped at 10 for the slot reservation', async () => {
    p.domainHealth.findMany.mockResolvedValue([{ domain: 'getacmesnow.com', status: 'HEALTHY', registeredAt: new Date(NOW.getTime() - 5 * 86_400_000) }])
    await processSendQueue(NOW)
    expect((reserveMailboxSlot as Fn).mock.calls[0][1]).toBe(10)
  })
```

In `assign-mailbox.test.ts`:
1. Add `organization: { findUnique: vi.fn() }` if absent.
2. Add `domainHealth: { findMany: vi.fn() }`.
3. Make the mailbox rows include `email`.
4. Add:

```ts
  it('Review Focus #1: in a Microsoft 365 org, skips mailboxes on unusable domains', async () => {
    p.organization.findUnique.mockResolvedValue({ msTenantId: 't' })
    p.mailbox.findMany.mockResolvedValue([
      { id: 'mb-bad', email: 'a@bad.com', _count: { enrollments: 0 } },
      { id: 'mb-ok', email: 'b@ok.com', _count: { enrollments: 9 } },
    ])
    p.domainHealth.findMany.mockResolvedValue([
      { domain: 'bad.com', status: 'FAILING', registeredAt: null },
      { domain: 'ok.com', status: 'WARNING', registeredAt: null },
    ])
    p.sequenceEnrollment.updateMany.mockResolvedValue({ count: 1 })
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBe('mb-ok')
  })

  it('returns null when every mailbox is on an unusable domain', async () => {
    p.organization.findUnique.mockResolvedValue({ msTenantId: 't' })
    p.mailbox.findMany.mockResolvedValue([{ id: 'mb-bad', email: 'a@bad.com', _count: { enrollments: 0 } }])
    p.domainHealth.findMany.mockResolvedValue([])
    expect(await assignEnrollmentMailbox('org-1', 'enr-1')).toBeNull()
  })
```

In `send-draft.test.ts`:
1. Add `domainHealth: { findMany: vi.fn() }` to the mock and type.
2. In `beforeEach`, set `mockPrisma.domainHealth.findMany.mockResolvedValue([{ domain: 'company.com', status: 'HEALTHY', registeredAt: new Date('2025-01-01') }])`. The existing mailboxes are `<id>@company.com`.
3. Append:

```ts
  it('Review Focus #1: Microsoft 365 org — refuses to send from a mailbox on an unverified domain', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ msTenantId: 'tenant-1', businessName: 'Acme Snow', postalAddress: '1 Main St, Buffalo, NY 14201', allowCanadianRecipients: false })
    setMailboxes([{ ...mailbox({ id: 'mb-1' }), provider: 'MICROSOFT_GRAPH' } as MailboxRow])
    mockPrisma.domainHealth.findMany.mockResolvedValue([{ domain: 'company.com', status: 'UNVERIFIED', registeredAt: null }])
    await expect(sendDraft(INPUT)).rejects.toBeInstanceOf(DomainNotHealthyError)
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  it('non-Microsoft 365 org — domain health is not consulted', async () => {
    mockPrisma.domainHealth.findMany.mockResolvedValue([])
    await expect(sendDraft(INPUT)).resolves.toMatchObject({ status: 'SENT' })
  })
```

For these, `MailboxRow` gains an optional `provider` field. `mailbox()` leaves it undefined, so existing fixtures are unchanged. Extend the `findMany` simulator filter with `&& (!where.provider || !m.provider || m.provider === where.provider)`. A row with no provider still matches, which keeps the existing Microsoft 365 (`tenant-1`) tests passing; they rely on the default `domainHealth` mock marking `company.com` HEALTHY.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/features/messages/server src/features/sequences/server/assign-mailbox.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`messages/types.ts` — append:

```ts
// Sending from a mailbox whose domain fails SPF/DKIM/MX (or was never checked)
// would land in spam or lose replies, so it is refused until the domain passes.
export class DomainNotHealthyError extends Error {
  constructor(public readonly domain: string, public readonly status: string) {
    super(
      status === 'UNVERIFIED'
        ? `Sending from ${domain} is on hold: the domain hasn't been verified yet. Open Deliverability and click "Check now".`
        : `Sending from ${domain} is on hold: its DNS records (SPF, DKIM or MX) aren't set up correctly. Open Deliverability for the exact fix.`,
    )
    this.name = 'DomainNotHealthyError'
    Object.setPrototypeOf(this, DomainNotHealthyError.prototype)
  }
}
```

`process-send-queue.ts`:
1. After the per-org `mailboxes` query, add:

   ```ts
   const domainHealth = await getDomainHealthMap(org.id)
   ```

2. Inside the mailbox loop, before `findFirst`, add:

   ```ts
         const dh = domainHealth.get(domainOf(mailbox.email))
         if (!isDomainUsable(dh?.status)) continue // blocked domain: messages stay QUEUED
   ```

3. Change `sendOne(next.id, mailbox, org, now)` to `sendOne(next.id, mailbox, org, now, dh ?? null)`.
4. Add the parameter `domain: { registeredAt: Date | null } | null` to `sendOne`.
5. Change `effectiveDailyLimit(mailbox, now)` to `effectiveDailyLimit(mailbox, now, domain)`.
6. Add the imports: `getDomainHealthMap, domainOf` from `@/features/deliverability/server/domain-health` and `isDomainUsable` from `@/features/deliverability/readiness`.

`assign-mailbox.ts`:
1. Add `email: true` to the `select`.
2. After fetching, when `org?.msTenantId`, add:

   ```ts
     let usable = mailboxes
     if (org?.msTenantId) {
       const domainHealth = await getDomainHealthMap(organizationId)
       usable = mailboxes.filter((m) => isDomainUsable(domainHealth.get(domainOf(m.email))?.status))
     }
     if (usable.length === 0) return null
   ```

3. Sort `usable` instead of `mailboxes`.

`send-draft.ts`, after `mailboxes` is determined (both the pinned and rotation branches):

```ts
  // Domain health (Microsoft 365 orgs): never send from a mailbox whose domain
  // fails SPF/DKIM/MX or was never verified. Pinned follow-ups fail loudly;
  // rotation drops blocked mailboxes and fails only if none remain.
  const domainHealth = graphOnly ? await getDomainHealthMap(organizationId) : null
  const domainFor = (m: { email: string }) => (domainHealth ? domainHealth.get(domainOf(m.email)) ?? null : null)
  if (domainHealth) {
    const blocked = mailboxes.filter((m) => !isDomainUsable(domainFor(m)?.status))
    mailboxes = mailboxes.filter((m) => isDomainUsable(domainFor(m)?.status))
    if (mailboxes.length === 0) {
      const first = blocked[0]!
      throw new DomainNotHealthyError(domainOf(first.email), domainFor(first)?.status ?? 'UNVERIFIED')
    }
  }
```

Then change both `effectiveDailyLimit(c.mailbox, now)` calls to `effectiveDailyLimit(c.mailbox, now, domainFor(c.mailbox))`, and add the imports.

`api/drafts/[id]/send/route.ts` — before the `LeadInTerminalStateError` branch:

```ts
    if (err instanceof DomainNotHealthyError) {
      return NextResponse.json({ code: 'DOMAIN_NOT_HEALTHY', error: err.message, domain: err.domain }, { status: 422 })
    }
```

Add `DomainNotHealthyError` to the `@/features/messages/types` import.

- [ ] **Step 4: Run to see them pass, then the full suite and typecheck**

Run: `npx vitest run src/features/messages src/features/sequences && npx tsc --noEmit && npm test`
Expected: all pass. If any existing queue test now fails because its fixture mailbox domain differs, give the `domainHealth` mock a row for that domain rather than weakening the assertion.

- [ ] **Step 5: Commit**

```bash
git add src/features/messages src/features/sequences/server/assign-mailbox* src/app/api/drafts
git commit -m "feat(deliverability): block sending from unhealthy domains; young-domain cap in every send path"
```

---

### Task 7: Check on import, and the daily refresh in the cron

**Files:**
- Modify: `src/features/integrations/server/microsoft.ts` (+ test)
- Modify: `src/app/api/cron/heartbeat-check/route.ts` (+ test)
- Modify: `vercel.json`

**Interfaces:**
- Consumes: `ensureDomainRows`, `checkDomain`, `refreshAllDomains` (Task 5).
- Produces:
  - `importGraphMailboxes` still returns `{ created }` and now also checks new domains.
  - The heartbeat-check JSON gains `domains: { checked, failed } | { error: string }`.

- [ ] **Step 1: Write the failing tests**

`microsoft.test.ts`:
1. Add `vi.mock('@/features/deliverability/server/domain-health', () => ({ ensureDomainRows: vi.fn().mockResolvedValue([{ id: 'dh-1', domain: 'getacmesnow.com' }]), checkDomain: vi.fn().mockResolvedValue({}) }))` and import both.
2. In the import test, add:

```ts
    expect(ensureDomainRows).toHaveBeenCalledWith('org-1')
    expect(checkDomain).toHaveBeenCalledWith('dh-1')
```

3. Add a test that a `checkDomain` rejection does not make `importGraphMailboxes` reject.

`heartbeat-check/route.test.ts`:
1. Add `vi.mock('@/features/deliverability/server/domain-health', () => ({ refreshAllDomains: vi.fn() }))`.
2. In `beforeEach`, set `refreshAllDomains` to resolve `{ checked: 1, failed: 0 }`.
3. Change the existing `toEqual` expectations to include `domains: { checked: 1, failed: 0 }`.
4. Add:

```ts
  it('refreshes domain health even when no jobs are stale, and survives a refresh failure', async () => {
    ;(getStaleJobs as Fn).mockResolvedValue([])
    ;(refreshAllDomains as Fn).mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(new Request('http://x'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ domains: { error: 'boom' } })
  })
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/features/integrations src/app/api/cron/heartbeat-check`
Expected: FAIL.

- [ ] **Step 3: Implement**

`importGraphMailboxes` — after `createMany`:

```ts
  // New sending domains are checked right away so they aren't blocked (as
  // UNVERIFIED) until the next daily run. Best-effort: DNS trouble never
  // fails the import.
  const fresh = await ensureDomainRows(organizationId)
  await Promise.allSettled(fresh.map((row) => checkDomain(row.id)))
```

`heartbeat-check/route.ts` — at the top of `GET`, after auth:

```ts
  // Daily domain health refresh (SPF/DKIM/MX/DMARC + registration date).
  let domains: { checked: number; failed: number } | { error: string }
  try {
    domains = await refreshAllDomains()
  } catch (err) {
    console.error('[heartbeat-check] domain refresh failed', err)
    domains = { error: err instanceof Error ? err.message : String(err) }
  }
```

Then include `domains` in every JSON response.

`vercel.json`: set `"schedule": "0 16 * * *"`.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/features/integrations src/app/api/cron && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/integrations src/app/api/cron/heartbeat-check vercel.json
git commit -m "feat(deliverability): check new domains on import and daily via the heartbeat cron"
```

---

### Task 8: Ramp actions — set preset and restart ramp

**Files:**
- Create: `src/features/mailboxes/server/set-mailbox-ramp.ts` (+ `.test.ts`)
- Modify: `src/features/mailboxes/types.ts`, `src/app/api/mailboxes/[id]/route.ts` (+ route test if present; otherwise create `route.test.ts`)

**Interfaces:**
- Produces:
  - `setMailboxRampPreset({ organizationId, mailboxId, rampPreset }): Promise<MailboxDTO>`
  - `restartMailboxRamp({ organizationId, mailboxId }): Promise<MailboxDTO>`
  - `MailboxDTO.rampPreset: RampPreset`
  - `PATCH /api/mailboxes/[id]` accepts `{ rampPreset }` or `{ restartRamp: true }`

- [ ] **Step 1: Write the failing tests**

`set-mailbox-ramp.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { mailbox: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() } } }))

import { prisma } from '@/lib/db/prisma'
import { setMailboxRampPreset, restartMailboxRamp } from './set-mailbox-ramp'
import { MailboxNotFoundError } from '../types'

type Fn = ReturnType<typeof vi.fn>
const row = {
  id: 'mb-1', organizationId: 'org-1', email: 'a@x.com', displayName: 'A', isActive: true, dailyLimit: 30, sentToday: 0,
  lastResetAt: new Date(), warmupEnabled: true, warmupStartedAt: new Date(), rampPreset: 'STANDARD', autoPaused: false,
  pausedAt: null, pauseReason: null, createdAt: new Date(), updatedAt: new Date(),
}
beforeEach(() => {
  vi.resetAllMocks()
  ;(prisma.mailbox.updateMany as Fn).mockResolvedValue({ count: 1 })
  ;(prisma.mailbox.findUniqueOrThrow as Fn).mockResolvedValue(row)
})

describe('mailbox ramp actions', () => {
  it('sets the preset org-scoped without touching the ramp day', async () => {
    const dto = await setMailboxRampPreset({ organizationId: 'org-1', mailboxId: 'mb-1', rampPreset: 'STANDARD' })
    expect(prisma.mailbox.updateMany).toHaveBeenCalledWith({ where: { id: 'mb-1', organizationId: 'org-1' }, data: { rampPreset: 'STANDARD' } })
    expect(dto.rampPreset).toBe('STANDARD')
  })
  it('restart sets warmupStartedAt to now and turns the ramp on', async () => {
    await restartMailboxRamp({ organizationId: 'org-1', mailboxId: 'mb-1' })
    expect((prisma.mailbox.updateMany as Fn).mock.calls[0][0].data).toEqual({ warmupStartedAt: expect.any(Date), warmupEnabled: true })
  })
  it('another org’s mailbox → MailboxNotFoundError', async () => {
    ;(prisma.mailbox.updateMany as Fn).mockResolvedValue({ count: 0 })
    await expect(restartMailboxRamp({ organizationId: 'org-2', mailboxId: 'mb-1' })).rejects.toBeInstanceOf(MailboxNotFoundError)
  })
})
```

Route tests (`src/app/api/mailboxes/[id]/route.test.ts`; follow the Clerk/`resolveOrganization` mock pattern from other route tests). Cover:

- `{ rampPreset: 'AGGRESSIVE' }` calls `setMailboxRampPreset`
- `{ rampPreset: 'TURBO' }` returns 400
- `{ restartRamp: true }` calls `restartMailboxRamp`
- `MailboxNotFoundError` returns 404

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/features/mailboxes src/app/api/mailboxes`
Expected: FAIL.

- [ ] **Step 3: Implement**

`set-mailbox-ramp.ts`:

```ts
import type { RampPreset } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { type MailboxDTO, toMailboxDTO, MailboxNotFoundError } from '../types'

async function updateScoped(organizationId: string, mailboxId: string, data: object): Promise<MailboxDTO> {
  const result = await prisma.mailbox.updateMany({ where: { id: mailboxId, organizationId }, data })
  if (result.count === 0) throw new MailboxNotFoundError()
  return toMailboxDTO(await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } }))
}

/** Change the ramp schedule. The ramp day is kept — only the table changes. */
export function setMailboxRampPreset(input: { organizationId: string; mailboxId: string; rampPreset: RampPreset }) {
  return updateScoped(input.organizationId, input.mailboxId, { rampPreset: input.rampPreset })
}

/** Start the ramp over from day 1 (e.g. after a long pause). */
export function restartMailboxRamp(input: { organizationId: string; mailboxId: string }) {
  return updateScoped(input.organizationId, input.mailboxId, { warmupStartedAt: new Date(), warmupEnabled: true })
}
```

In `mailboxes/types.ts`, add `rampPreset: RampPreset` to `MailboxDTO`, `rampPreset: m.rampPreset` to `toMailboxDTO`, and import `RampPreset` from `@prisma/client`.

In the route, widen the body type to include `rampPreset?: unknown; restartRamp?: unknown`. Before the `warmupEnabled` branch, add:

```ts
    if (body.restartRamp === true) {
      return NextResponse.json(await restartMailboxRamp({ organizationId: org.id, mailboxId: id }))
    }
    if (body.rampPreset !== undefined) {
      if (body.rampPreset !== 'CONSERVATIVE' && body.rampPreset !== 'STANDARD' && body.rampPreset !== 'AGGRESSIVE') {
        return NextResponse.json({ error: 'rampPreset must be CONSERVATIVE, STANDARD or AGGRESSIVE' }, { status: 400 })
      }
      return NextResponse.json(await setMailboxRampPreset({ organizationId: org.id, mailboxId: id, rampPreset: body.rampPreset }))
    }
```

Update the 400 fallback message to list all options.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/features/mailboxes src/app/api/mailboxes && npx tsc --noEmit`
Expected: PASS. Fix any test fixture that builds a `MailboxDTO` without `rampPreset`.

- [ ] **Step 5: Commit**

```bash
git add src/features/mailboxes src/app/api/mailboxes
git commit -m "feat(mailboxes): change ramp preset and restart ramp"
```

---

### Task 9: Overview aggregation (pure) and loader

**Files:**
- Create: `src/features/deliverability/types.ts`
- Create: `src/features/deliverability/overview.ts` (+ `.test.ts`)
- Create: `src/features/deliverability/server/get-overview.ts`

**Interfaces:**
- Consumes: `mailboxReadiness`, `isDomainUsable` (Task 2); `effectiveDailyLimit`, `warmupDay`, `rampFullDay` (Task 2); `DomainCheck` (Task 3); `domainOf` (Task 5).
- Produces (types.ts):
  - `TrendPoint { day: string; sent: number; bounces: number; replies: number }`
  - `DomainRowDTO { id; domain; status; checks: DomainCheck[]; registeredAt: string | null; registeredAtSource: string | null; young: boolean; lastCheckedAt: string | null; lastError: string | null }`
  - `MailboxRowDTO { id; email; displayName; domain; domainStatus: DomainStatusName | null; rampPreset; warmupEnabled; rampDay: number; rampFullDay: number; todayLimit: number; sentToday: number; sent14: number; bounces14: number; replies14: number; bounceRate: number; replyRate: number; state: MailboxState; readyOn: string | null; detail: string; autoPaused: boolean }`
  - `DeliverabilityOverview { summary: { domains: Record<DomainStatusName, number>; mailboxes: Record<MailboxState, number>; capacityToday: number; queuedNext24h: number; sent14: number; bounceRate14: number; replyRate14: number }; domains: DomainRowDTO[]; mailboxes: MailboxRowDTO[]; trend: TrendPoint[]; trendByMailbox: Record<string, TrendPoint[]> }`
- Produces (overview.ts):
  - `dayKey(date: Date, timezone: string): string` (`YYYY-MM-DD` in the tz)
  - `lastNDays(now, timezone, n = 14): string[]`
  - `buildOverview(input: OverviewInput): DeliverabilityOverview`
- Produces (get-overview.ts): `getDeliverabilityOverview(organizationId: string, now = new Date()): Promise<DeliverabilityOverview>`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { buildOverview, dayKey, lastNDays, type OverviewInput } from './overview'

const NOW = new Date('2026-09-25T16:00:00Z') // 12:00 ET
const TZ = 'America/New_York'
const d = (iso: string) => new Date(iso)

const input = (o: Partial<OverviewInput> = {}): OverviewInput => ({
  now: NOW,
  timezone: TZ,
  mailboxes: [
    {
      id: 'mb-1', email: 'mike@acme.com', displayName: 'Mike', dailyLimit: 30, sentToday: 4, lastResetAt: NOW,
      warmupEnabled: true, warmupStartedAt: new Date(NOW.getTime() - 40 * 86_400_000), rampPreset: 'CONSERVATIVE',
      isActive: true, autoPaused: false, pauseReason: null,
    },
  ],
  domains: [
    { id: 'dh-1', domain: 'acme.com', status: 'HEALTHY', checks: [], registeredAt: d('2024-01-01'), registeredAtSource: 'rdap', lastCheckedAt: NOW, lastError: null },
  ],
  sends: [
    { mailboxId: 'mb-1', sentAt: d('2026-09-25T03:30:00Z') }, // 23:30 ET on 09-24
    { mailboxId: 'mb-1', sentAt: d('2026-09-25T14:00:00Z') }, // 10:00 ET on 09-25
  ],
  bounces: [{ mailboxId: 'mb-1', at: d('2026-09-25T15:00:00Z') }],
  replies: [{ mailboxId: 'mb-1', at: d('2026-09-25T15:30:00Z') }],
  queuedNext24h: 7,
  ...o,
})

describe('dayKey / lastNDays', () => {
  it('Review Focus #5: buckets by the org timezone, not UTC', () => {
    expect(dayKey(d('2026-09-25T03:30:00Z'), TZ)).toBe('2026-09-24')
  })
  it('14 consecutive days ending today', () => {
    const days = lastNDays(NOW, TZ)
    expect(days).toHaveLength(14)
    expect(days[13]).toBe('2026-09-25')
    expect(days[0]).toBe('2026-09-12')
  })
})

describe('buildOverview', () => {
  it('trend counts per org-timezone day', () => {
    const o = buildOverview(input())
    expect(o.trend.find((t) => t.day === '2026-09-24')).toEqual({ day: '2026-09-24', sent: 1, bounces: 0, replies: 0 })
    expect(o.trend.find((t) => t.day === '2026-09-25')).toEqual({ day: '2026-09-25', sent: 1, bounces: 1, replies: 1 })
    expect(o.trendByMailbox['mb-1']).toHaveLength(14)
  })
  it('mailbox row: ramp, limits, rates and readiness', () => {
    const row = buildOverview(input()).mailboxes[0]!
    expect(row).toMatchObject({ domain: 'acme.com', domainStatus: 'HEALTHY', todayLimit: 30, sentToday: 4, sent14: 2, bounces14: 1, replies14: 1, bounceRate: 0.5, replyRate: 0.5, state: 'READY' })
  })
  it('sentToday is 0 after the daily reset boundary', () => {
    const row = buildOverview(input({ mailboxes: [{ ...input().mailboxes[0]!, lastResetAt: new Date(NOW.getTime() - 2 * 86_400_000) }] })).mailboxes[0]!
    expect(row.sentToday).toBe(0)
  })
  it('summary: counts, capacity over usable mailboxes only, zero-safe rates', () => {
    const o = buildOverview(input({ sends: [], bounces: [], replies: [] }))
    expect(o.summary).toMatchObject({ capacityToday: 30, queuedNext24h: 7, sent14: 0, bounceRate14: 0, replyRate14: 0 })
    expect(o.summary.domains.HEALTHY).toBe(1)
    expect(o.summary.mailboxes.READY).toBe(1)

    const blocked = buildOverview(input({ domains: [{ ...input().domains[0]!, status: 'FAILING' }] }))
    expect(blocked.summary.capacityToday).toBe(0)
    expect(blocked.mailboxes[0]!.state).toBe('BLOCKED')
  })
  it('domain rows flag young domains and parse checks', () => {
    const young = buildOverview(input({ domains: [{ ...input().domains[0]!, registeredAt: new Date(NOW.getTime() - 3 * 86_400_000) }] }))
    expect(young.domains[0]!.young).toBe(true)
    expect(young.mailboxes[0]!.todayLimit).toBe(10)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/features/deliverability/overview.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`types.ts` — the DTOs exactly as listed in Interfaces. Import `DomainCheck` from `./evaluate-domain`; import `MailboxState` and `DomainStatusName` from `./readiness`; import `RampPresetName` from `@/features/mailboxes/warmup`.

`overview.ts`:

```ts
import { effectiveDailyLimit, isYoungDomain, rampFullDay, warmupDay, type RampPresetName } from '@/features/mailboxes/warmup'
import { isDomainUsable, mailboxReadiness, type DomainStatusName, type MailboxState } from './readiness'
import type { DomainCheck } from './evaluate-domain'
import type { DeliverabilityOverview, DomainRowDTO, MailboxRowDTO, TrendPoint } from './types'

const DAY_MS = 86_400_000

export interface OverviewInput {
  now: Date
  timezone: string
  mailboxes: {
    id: string; email: string; displayName: string; dailyLimit: number; sentToday: number; lastResetAt: Date
    warmupEnabled: boolean; warmupStartedAt: Date; rampPreset: RampPresetName; isActive: boolean
    autoPaused: boolean; pauseReason: string | null
  }[]
  domains: {
    id: string; domain: string; status: DomainStatusName; checks: unknown; registeredAt: Date | null
    registeredAtSource: string | null; lastCheckedAt: Date | null; lastError: string | null
  }[]
  sends: { mailboxId: string; sentAt: Date }[]
  bounces: { mailboxId: string; at: Date }[]
  replies: { mailboxId: string; at: Date }[]
  queuedNext24h: number
}

export function dayKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function lastNDays(now: Date, timezone: string, n = 14): string[] {
  return Array.from({ length: n }, (_, i) => dayKey(new Date(now.getTime() - (n - 1 - i) * DAY_MS), timezone))
}

const rate = (num: number, den: number) => (den > 0 ? num / den : 0)
const domainOfEmail = (email: string) => (email.split('@')[1] ?? '').toLowerCase()
const startOfDay = (d: Date) => { const s = new Date(d); s.setHours(0, 0, 0, 0); return s }

export function buildOverview(i: OverviewInput): DeliverabilityOverview {
  const days = lastNDays(i.now, i.timezone)
  const daySet = new Set(days)
  const domainByName = new Map(i.domains.map((dm) => [dm.domain, dm]))

  const emptyTrend = () => days.map((day) => ({ day, sent: 0, bounces: 0, replies: 0 }))
  const trend: TrendPoint[] = emptyTrend()
  const trendByMailbox: Record<string, TrendPoint[]> = Object.fromEntries(i.mailboxes.map((m) => [m.id, emptyTrend()]))
  const bump = (mailboxId: string, at: Date, field: 'sent' | 'bounces' | 'replies') => {
    const key = dayKey(at, i.timezone)
    if (!daySet.has(key)) return
    const idx = days.indexOf(key)
    trend[idx]![field]++
    const mb = trendByMailbox[mailboxId]
    if (mb) mb[idx]![field]++
  }
  i.sends.forEach((s) => bump(s.mailboxId, s.sentAt, 'sent'))
  i.bounces.forEach((b) => bump(b.mailboxId, b.at, 'bounces'))
  i.replies.forEach((r) => bump(r.mailboxId, r.at, 'replies'))

  const sum = (pts: TrendPoint[] | undefined, f: 'sent' | 'bounces' | 'replies') => (pts ?? []).reduce((a, p) => a + p[f], 0)

  const mailboxes: MailboxRowDTO[] = i.mailboxes.map((m) => {
    const domain = domainOfEmail(m.email)
    const dh = domainByName.get(domain) ?? null
    const sent14 = sum(trendByMailbox[m.id], 'sent')
    const bounces14 = sum(trendByMailbox[m.id], 'bounces')
    const replies14 = sum(trendByMailbox[m.id], 'replies')
    const readiness = mailboxReadiness({
      mailbox: m,
      domain: dh ? { status: dh.status, registeredAt: dh.registeredAt } : null,
      sent14, bounces14, now: i.now,
    })
    return {
      id: m.id, email: m.email, displayName: m.displayName, domain,
      domainStatus: dh?.status ?? null,
      rampPreset: m.rampPreset, warmupEnabled: m.warmupEnabled,
      rampDay: warmupDay(m.warmupStartedAt, i.now), rampFullDay: rampFullDay(m.rampPreset),
      todayLimit: effectiveDailyLimit(m, i.now, dh ? { registeredAt: dh.registeredAt } : null),
      sentToday: m.lastResetAt < startOfDay(i.now) ? 0 : m.sentToday,
      sent14, bounces14, replies14,
      bounceRate: rate(bounces14, sent14), replyRate: rate(replies14, sent14),
      state: readiness.state, readyOn: readiness.readyOn?.toISOString() ?? null, detail: readiness.detail,
      autoPaused: m.autoPaused,
    }
  })

  const domains: DomainRowDTO[] = i.domains.map((dm) => ({
    id: dm.id, domain: dm.domain, status: dm.status,
    checks: Array.isArray(dm.checks) ? (dm.checks as DomainCheck[]) : [],
    registeredAt: dm.registeredAt?.toISOString() ?? null, registeredAtSource: dm.registeredAtSource,
    young: isYoungDomain({ registeredAt: dm.registeredAt }, i.now),
    lastCheckedAt: dm.lastCheckedAt?.toISOString() ?? null, lastError: dm.lastError,
  }))

  const count = <K extends string>(keys: readonly K[], values: K[]) =>
    Object.fromEntries(keys.map((k) => [k, values.filter((v) => v === k).length])) as Record<K, number>
  const sent14 = sum(trend, 'sent')

  return {
    summary: {
      domains: count(['UNVERIFIED', 'HEALTHY', 'WARNING', 'FAILING'] as const, domains.map((dm) => dm.status)),
      mailboxes: count(['READY', 'RAMPING', 'PAUSED', 'BLOCKED', 'NEEDS_ATTENTION'] as const, mailboxes.map((m) => m.state as MailboxState)),
      capacityToday: mailboxes
        .filter((m) => m.state !== 'PAUSED' && isDomainUsable(m.domainStatus))
        .reduce((a, m) => a + (Number.isFinite(m.todayLimit) ? m.todayLimit : 0), 0),
      queuedNext24h: i.queuedNext24h,
      sent14,
      bounceRate14: rate(sum(trend, 'bounces'), sent14),
      replyRate14: rate(sum(trend, 'replies'), sent14),
    },
    domains, mailboxes, trend, trendByMailbox,
  }
}
```

`server/get-overview.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import { buildOverview } from '../overview'
import type { DeliverabilityOverview } from '../types'

const WINDOW_MS = 15 * 86_400_000 // 14 display days + slack for timezone edges

export async function getDeliverabilityOverview(organizationId: string, now = new Date()): Promise<DeliverabilityOverview> {
  const since = new Date(now.getTime() - WINDOW_MS)
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true, msTenantId: true } })
  const [mailboxes, domains, sends, bounces, replies, queuedNext24h] = await Promise.all([
    prisma.mailbox.findMany({
      where: { organizationId, ...(org.msTenantId && { provider: 'MICROSOFT_GRAPH' as const }) },
      orderBy: { email: 'asc' },
    }),
    prisma.domainHealth.findMany({ where: { organizationId }, orderBy: { domain: 'asc' } }),
    prisma.outboundMessage.findMany({ where: { organizationId, sentAt: { gte: since } }, select: { mailboxId: true, sentAt: true } }),
    prisma.messageEvent.findMany({
      where: { organizationId, eventType: 'BOUNCED', createdAt: { gte: since } },
      select: { createdAt: true, outboundMessage: { select: { mailboxId: true } } },
    }),
    prisma.inboundReply.findMany({
      where: { organizationId, receivedAt: { gte: since }, classification: { not: 'OUT_OF_OFFICE' }, mailboxId: { not: null } },
      select: { mailboxId: true, receivedAt: true },
    }),
    prisma.outboundMessage.count({ where: { organizationId, status: 'QUEUED', scheduledFor: { lte: new Date(now.getTime() + 86_400_000) } } }),
  ])
  return buildOverview({
    now, timezone: org.timezone, mailboxes, domains, queuedNext24h,
    sends: sends.filter((s) => s.sentAt).map((s) => ({ mailboxId: s.mailboxId, sentAt: s.sentAt! })),
    bounces: bounces.map((b) => ({ mailboxId: b.outboundMessage.mailboxId, at: b.createdAt })),
    replies: replies.map((r) => ({ mailboxId: r.mailboxId!, at: r.receivedAt })),
  })
}
```

- [ ] **Step 4: Run to see them pass, then typecheck**

Run: `npx vitest run src/features/deliverability && npx tsc --noEmit`
Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/deliverability
git commit -m "feat(deliverability): 14-day overview aggregation in the org timezone"
```

---

### Task 10: Domain API routes (recheck, registration date)

**Files:**
- Create:
  - `src/app/api/deliverability/domains/[id]/recheck/route.ts` (+ `route.test.ts`)
  - `src/app/api/deliverability/domains/[id]/route.ts` (+ `route.test.ts`)

**Interfaces:**
- Consumes: `checkDomain`, `RECHECK_MIN_INTERVAL_MS` (Task 5).
- Produces:
  - `POST …/recheck` → 200 `{ status, lastError }`, 404, or 429 `{ retryAfterSeconds }`
  - `PATCH …/[id]` with `{ registeredAt: 'YYYY-MM-DD' }` → 200, 400, or 404

- [ ] **Step 1: Write the failing tests**

Recheck route test:
- Mock `@clerk/nextjs/server`, `@/lib/auth/resolve-organization` (→ `{ id: 'org-1' }`), `@/lib/db/prisma` (`domainHealth.findFirst`), and `@/features/deliverability/server/domain-health` (`checkDomain`, real `RECHECK_MIN_INTERVAL_MS` via `importOriginal`).
- Cases:
  - no org → 403
  - other org's row (`findFirst` returns null) → 404, and `findFirst` was called with `{ where: { id, organizationId: 'org-1' } }`
  - `lastAttemptAt` 10 s ago → 429 with `retryAfterSeconds` between 49 and 50, and `checkDomain` not called
  - `lastAttemptAt` 2 min ago → `checkDomain('dh-1')` called and 200 `{ status: 'HEALTHY' }`

PATCH route test cases:
- `{ registeredAt: '2026-08-01' }` → `update` with `{ registeredAt: new Date('2026-08-01T00:00:00Z'), registeredAtSource: 'manual' }`
- `{ registeredAt: 'soon' }` → 400
- a future date → 400
- before 1985 → 400
- other org → 404

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/app/api/deliverability`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`recheck/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { checkDomain, RECHECK_MIN_INTERVAL_MS } from '@/features/deliverability/server/domain-health'

export const maxDuration = 30

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params
  const org = await resolveOrganization(orgId)

  const row = await prisma.domainHealth.findFirst({ where: { id, organizationId: org.id } })
  if (!row) return NextResponse.json({ error: 'Domain not found' }, { status: 404 })

  const sinceLast = row.lastAttemptAt ? Date.now() - row.lastAttemptAt.getTime() : Infinity
  if (sinceLast < RECHECK_MIN_INTERVAL_MS) {
    return NextResponse.json(
      { error: 'Checked moments ago — try again shortly.', retryAfterSeconds: Math.ceil((RECHECK_MIN_INTERVAL_MS - sinceLast) / 1000) },
      { status: 429 },
    )
  }
  const updated = await checkDomain(row.id)
  return NextResponse.json({ status: updated.status, lastError: updated.lastError })
}
```

`[id]/route.ts` (PATCH):

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

const EARLIEST = new Date('1985-01-01T00:00:00Z') // first .com registrations

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params

  const body = (await request.json().catch(() => null)) as { registeredAt?: unknown } | null
  const raw = body?.registeredAt
  const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : null
  if (!date || Number.isNaN(date.getTime()) || date > new Date() || date < EARLIEST) {
    return NextResponse.json({ error: 'registeredAt must be a past date (YYYY-MM-DD)' }, { status: 400 })
  }

  const org = await resolveOrganization(orgId)
  const result = await prisma.domainHealth.updateMany({
    where: { id, organizationId: org.id },
    data: { registeredAt: date, registeredAtSource: 'manual' },
  })
  if (result.count === 0) return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
  return NextResponse.json({ registeredAt: date.toISOString(), registeredAtSource: 'manual' })
}
```

Adjust the PATCH test's expected call to `updateMany` with `{ where: { id, organizationId: 'org-1' }, data: {...} }`.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/app/api/deliverability && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/deliverability
git commit -m "feat(deliverability): recheck and registration-date routes"
```

---

### Task 11: Dashboard page and sidebar

**Files:**
- Create:
  - `src/app/(dashboard)/deliverability/page.tsx`
  - `src/features/deliverability/components/deliverability-client.tsx` (+ `.test.tsx`)
- Modify: `src/components/layout/sidebar.tsx`

**Interfaces:**
- Consumes:
  - `getDeliverabilityOverview` and `DeliverabilityOverview` (Task 9)
  - routes: `POST /api/deliverability/domains/[id]/recheck`, `PATCH /api/deliverability/domains/[id]`, `PATCH /api/mailboxes/[id]` (`rampPreset` / `restartRamp` / `resume`)
- Produces: `<DeliverabilityClient overview={DeliverabilityOverview} />` and the `/deliverability` page.

Before writing the chart, load the `dataviz` skill (chart colors, axis and legend rules). Use `LazyResponsiveContainer`/`LazyLineChart` (or `LazyBarChart`) from `@/components/charts/recharts-wrapper`, and the `Line`/`Bar`/axis re-exports it provides. Style with the existing CSS variables and components (`StatCard`, `Badge`, `Button`), matching the campaign detail page.

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/components/charts/recharts-wrapper', () => ({
  LazyResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart">{children}</div>,
  LazyLineChart: () => null, Line: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Legend: () => null, CartesianGrid: () => null,
}))

import { DeliverabilityClient } from './deliverability-client'
import type { DeliverabilityOverview } from '../types'

const overview: DeliverabilityOverview = {
  summary: {
    domains: { UNVERIFIED: 1, HEALTHY: 0, WARNING: 0, FAILING: 1 },
    mailboxes: { READY: 0, RAMPING: 1, PAUSED: 0, BLOCKED: 1, NEEDS_ATTENTION: 0 },
    capacityToday: 3, queuedNext24h: 5, sent14: 20, bounceRate14: 0.05, replyRate14: 0.1,
  },
  domains: [
    { id: 'dh-1', domain: 'bad.com', status: 'FAILING', checks: [{ record: 'MX', result: 'fail', found: null, fix: 'Point bad.com MX to Microsoft 365' }], registeredAt: null, registeredAtSource: null, young: true, lastCheckedAt: '2026-09-25T10:00:00Z', lastError: null },
    { id: 'dh-2', domain: 'new.com', status: 'UNVERIFIED', checks: [], registeredAt: null, registeredAtSource: null, young: true, lastCheckedAt: null, lastError: null },
  ],
  mailboxes: [
    { id: 'mb-1', email: 'a@new.com', displayName: 'A', domain: 'new.com', domainStatus: 'UNVERIFIED', rampPreset: 'CONSERVATIVE', warmupEnabled: true, rampDay: 2, rampFullDay: 29, todayLimit: 3, sentToday: 1, sent14: 20, bounces14: 1, replies14: 2, bounceRate: 0.05, replyRate: 0.1, state: 'BLOCKED', readyOn: null, detail: 'Domain not verified yet — click Check now', autoPaused: false },
  ],
  trend: [], trendByMailbox: { 'mb-1': [] },
}

const fetchMock = vi.fn()
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'HEALTHY' }), { status: 200 }))
})

describe('DeliverabilityClient', () => {
  it('shows summary, a failing domain with its fix, and a blocked mailbox with the reason', () => {
    render(<DeliverabilityClient overview={overview} />)
    expect(screen.getByText('bad.com')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /show fixes for bad\.com/i }))
    expect(screen.getByText(/Point bad\.com MX to Microsoft 365/)).toBeInTheDocument()
    expect(screen.getByText(/Domain not verified yet/)).toBeInTheDocument()
  })

  it('"Check now" on an unverified domain POSTs recheck and refreshes', async () => {
    render(<DeliverabilityClient overview={overview} />)
    fireEvent.click(screen.getByRole('button', { name: /check now.*new\.com/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/deliverability/domains/dh-2/recheck', { method: 'POST' }))
    expect(refresh).toHaveBeenCalled()
  })

  it('a 429 shows the wait message instead of failing silently', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Checked moments ago — try again shortly.', retryAfterSeconds: 42 }), { status: 429 }))
    render(<DeliverabilityClient overview={overview} />)
    fireEvent.click(screen.getByRole('button', { name: /check now.*new\.com/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i)
  })

  it('changing the preset PATCHes the mailbox', async () => {
    render(<DeliverabilityClient overview={overview} />)
    fireEvent.change(screen.getByLabelText(/ramp preset for a@new\.com/i), { target: { value: 'STANDARD' } })
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/mailboxes/mb-1', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ rampPreset: 'STANDARD' }) })),
    )
  })

  it('saving a registration date PATCHes the domain', async () => {
    render(<DeliverabilityClient overview={overview} />)
    fireEvent.change(screen.getByLabelText(/registration date for new\.com/i), { target: { value: '2026-08-01' } })
    fireEvent.click(screen.getByRole('button', { name: /save date for new\.com/i }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/deliverability/domains/dh-2', expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ registeredAt: '2026-08-01' }) })),
    )
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/features/deliverability/components`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `deliverability-client.tsx`**

This is a client component. It keeps one `error` state, rendered as `role="alert"`, and each network action is wrapped in try/catch/finally so busy states always reset. It has these sections:

1. **Summary.** Four `StatCard`s:
   - Domains: "`<HEALTHY+WARNING>` of `<total>` healthy", with the failing and unverified counts as a sub-line
   - Mailboxes: "`<READY>` ready", with ramping, paused and blocked as a sub-line
   - Capacity today: "`<capacityToday>`/day", with "`<queuedNext24h>` queued (next 24h)"
   - 14 days: "`<sent14>` sent", with the bounce % and reply % (one decimal)
2. **Domains table.** Per row:
   - the domain
   - status `Badge` (HEALTHY=success, WARNING=warning, FAILING=danger, UNVERIFIED=muted)
   - SPF/DKIM/MX/DMARC chips from `checks` (pass=success, warn=warning, fail=danger, info=muted; "—" when no checks)
   - age: registration date, a "young" badge, or "unknown"
   - last checked (relative, via `relativeTime` from `@/lib/format`), or `lastError`
   - a **Check now** button when UNVERIFIED, **Recheck now** otherwise, with `aria-label` "Check now for <domain>" / "Recheck now for <domain>"
   - a **Show fixes** toggle (`aria-label` "Show fixes for <domain>") that expands a row listing each non-pass check's `found` and `fix`
   - when `registeredAt` is null or `registeredAtSource` is not `'rdap'`, a date input (`aria-label` "Registration date for <domain>") and a **Save** button (`aria-label` "Save date for <domain>") that PATCHes and refreshes
   - Recheck: `POST /api/deliverability/domains/<id>/recheck`. On a non-OK response, show `error` from the JSON. Always call `router.refresh()` after a 200.
3. **Mailboxes table.** Per row:
   - address
   - domain status badge
   - preset `<select>` (`aria-label` "Ramp preset for <email>"; options Conservative/Standard/Aggressive), which PATCHes `{ rampPreset }` on change and then refreshes
   - "Day `<rampDay>` / `<rampFullDay-1>`" (or "Ramp off")
   - today: "`<sentToday>` / `<todayLimit>`"
   - 14-day sent, bounce %, reply %
   - state `Badge` (READY=success, RAMPING=default, PAUSED=warning, BLOCKED=danger, NEEDS_ATTENTION=danger) with `detail`, plus "ready ~<date>" when `readyOn` is set
   - actions: **Restart ramp** (confirm via `window.confirm`, then PATCH `{ restartRamp: true }`) and **Resume** when `autoPaused` (PATCH `{ resume: true }`)
4. **Trend.** A `<select>` for "All mailboxes" or one mailbox, and a line chart of sent / bounces / replies over `trend` or `trendByMailbox[id]` (day label `MM-DD`). Follow the dataviz skill for colors. Show a "No sends in the last 14 days yet" message when every point is zero.

`page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getDeliverabilityOverview } from '@/features/deliverability/server/get-overview'
import { DeliverabilityClient } from '@/features/deliverability/components/deliverability-client'

export default async function DeliverabilityPage() {
  const { orgId } = await auth()
  if (!orgId) redirect('/dashboard')
  const org = await resolveOrganization(orgId)
  let overview
  try {
    overview = await getDeliverabilityOverview(org.id)
  } catch (err) {
    console.error('[deliverability page]', err)
    return (
      <>
        <Header title="Deliverability" />
        <div className="flex-1 p-6 lg:p-8">
          <p role="alert" className="text-[var(--status-danger)] text-sm">Couldn&apos;t load deliverability data. Refresh the page to try again.</p>
        </div>
      </>
    )
  }
  return (
    <>
      <Header title="Deliverability" />
      <div className="flex-1 p-6 lg:p-8">
        <DeliverabilityClient overview={overview} />
      </div>
    </>
  )
}
```

`sidebar.tsx`: import `ShieldCheck` from `lucide-react` and add `{ href: '/deliverability', icon: ShieldCheck, label: 'Deliverability' }` after the Analytics entry. Update any sidebar test that counts nav items.

- [ ] **Step 4: Run to see them pass, then the full suite, typecheck and lint**

Run: `npx vitest run src/features/deliverability src/components/layout && npx tsc --noEmit && npx eslint src/features/deliverability "src/app/(dashboard)/deliverability" src/components/layout && npm test`
Expected: all clean. Visually check the page by running `npm run dev` (the local `.env` points at the Neon dev branch) and opening `/deliverability`. Confirm:
- empty states render (no Graph mailboxes on dev) without errors
- the layout works at a 375 px width

- [ ] **Step 5: Commit**

```bash
git add src/features/deliverability/components "src/app/(dashboard)/deliverability" src/components/layout/sidebar.tsx
git commit -m "feat(deliverability): dashboard page with domains, mailboxes and 14-day trend"
```

---

### Task 12: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a "Deliverability" section under the Microsoft 365 setup**

It covers:

- **Ramp presets.** The table from Global Constraints. The default is Conservative; change it per mailbox on the Deliverability page; Restart ramp is there too.
- **The young-domain rule.** A domain registered less than 30 days ago (or with an unknown date) is held to 10/day. Set the date on the page if the registry doesn't return one.
- **Domain checks.**
  - SPF must include `spf.protection.outlook.com` and end with `-all` or `~all`.
  - Both Microsoft 365 DKIM CNAMEs must exist, and DKIM must be enabled in Defender.
  - MX must point to `*.mail.protection.outlook.com`.
  - DMARC is recommended and only warns.
  - A failing or never-checked domain holds all sending from its mailboxes. Queued email waits and is not lost.
  - Checks run on import, daily, and via Recheck now.
- **Alerts.** One email when a domain starts failing, one on recovery.
- **What the app deliberately does not do.** No automated opens, replies, or spam rescue. That violates Google's and Microsoft's terms. Warmup here means careful real sending.

- [ ] **Step 2: Commit**

```bash
git add README.md && git commit -m "docs: deliverability suite (ramp presets, domain checks, dashboard)"
```

---

## Self-review notes (for the executor)

**Spec coverage**

| Spec section | Task(s) |
|---|---|
| Ramp (presets, young domain, readiness, actions) | 2, 8 |
| Domain health (model, checks, lookup errors, RDAP, schedule, alerts) | 1, 3, 4, 5, 7, 10 |
| Enforcement (queue, assign, manual send) | 6 |
| Dashboard | 9, 11 |
| Error-handling table | 5, 6, 9, 10, 11 |
| Migration | 1 |
| Docs | 12 |

**Interfaces that cross tasks, and must match**

- `effectiveDailyLimit(m, now, domain?)`
- `isDomainUsable(status)`
- `getDomainHealthMap` / `domainOf`
- `checkDomain(id, deps?)`
- `RECHECK_MIN_INTERVAL_MS`
- `DomainNotHealthyError(domain, status)`
- `DeliverabilityOverview` and its row DTOs
