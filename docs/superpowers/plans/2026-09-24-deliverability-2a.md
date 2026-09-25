# Deliverability Round 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify each lead's email address (MillionVerifier) before its first email and score templates for spam risk before a campaign sends, blocking invalid addresses and high-risk content.

**Architecture:**
- **Verification:**
  - Lead rows carry an `emailCheck` state.
  - A background worker runs at the start of the existing sequence-runner cron and resolves `PENDING` leads through a provider interface.
  - A pure `verificationGate` decides send / wait / stop for a lead's first email. It is used in the sequence runner (step 1) and in manual Send.
- **Content check:**
  - A pure `checkContent` scores one subject+body.
  - A server gate evaluates a campaign's steps and variants whenever auto-send is enabled or live content changes.
  - It honors an override tied to a SHA-256 hash of the content.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict (`noUncheckedIndexedAccess`), Prisma 7 + Neon Postgres, Clerk Organizations, Vitest + Testing Library, Tailwind v4 CSS variables.

**Spec:** `docs/superpowers/specs/2026-09-24-deliverability-2a-design.md`

## Global Constraints

- **MillionVerifier API:**
  - Endpoint: `GET https://api.millionverifier.com/api/v3/?api=<key>&email=<email>&timeout=10`
  - Client timeout: 15 s
  - Key: env `MILLIONVERIFIER_API_KEY`
  - Verification is off (gate always `send`) when the key is unset.
- **Result mapping:**
  - `ok` → `OK`
  - `catch_all`, `unknown` → `RISKY`
  - `invalid`, `disposable` → `INVALID`
  - 3 `retry` attempts → `RISKY` with result `unknown`
- **Verification limits:**
  - Result freshness: 90 days.
  - Worker budget: 10 s (inside the sequence runner's existing 25 s budget).
  - Concurrency: 5.
  - Order: oldest `updatedAt` first.
- **Step-1 wait:** push `nextDueAt` to now + 10 minutes.
- **Alerting:**
  - An account error (no credits / bad key) stops the worker run and leaves leads `PENDING`.
  - Alert once per org, claimed atomically on `Organization.verificationAlertedAt`.
  - The claim clears after that org's next successful result.
- **Error codes:**
  - Manual Send of a first email that isn't cleared → 422 `EMAIL_NOT_VERIFIED`.
  - Content gate → 422 `CONTENT_HIGH_RISK`, with the findings in the body.
- **Content levels:**
  - The level is the highest severity.
  - 3 or more MEDIUM findings → HIGH.
  - No findings → LOW.
- **Override:**
  - Reason: 10–500 characters after trimming.
  - Stored with a SHA-256 hash of the campaign content.
  - Valid only while the hash matches.
- **Existing patterns:**
  - Every Graph/Microsoft path and all SendGrid behavior stay untouched.
  - Never print `.env` values.
  - Commit on branch `feat/deliverability-2a`, never on `main`.
- **Commit trailer:** every commit message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Rulings on spec gaps (made while planning)

- **R1:** `Organization` also gains `verificationPausedReason String?`. The spec's Deliverability note shows "Verification paused: <reason>", which needs the reason stored.
- **R2:** `enrollLead` sets `PENDING` only when verification is configured. Otherwise leads would show "Verifying" forever with no key (success criterion 4). If a key is added later, the step-1 gate queues them.
- **R3:** `checkContent` also takes the org's `allowedWords`, so words the guardrails already allow (e.g. "free") aren't flagged. This mirrors `checkGuardrails`.
- **R4:** `verificationGate` returns `{ action: 'send' | 'wait' } | { action: 'stop'; reason }` instead of a bare string, so callers get the stop reason.
- **R5:** Variant item keys are `variant:<sequenceId>:<variantId>`, so replacing a sequence's steps also drops its variants. The DB cascades them.

## Review Focus

1. **A bounce arrives while a verification call for the same lead is in flight.** The worker must not overwrite `INVALID` with `OK`. All worker writes are `updateMany … where emailCheck: 'PENDING'` (Task 4 test).
2. **Leads enrolled before the key existed, or before this shipped (`UNCHECKED`), reach step 1.** They must be queued (`PENDING`) and wait, not send unverified and not stall forever (Task 5 test).
3. **One address keeps timing out.** It must not block the queue: a retried lead's `updatedAt` moves it to the back (oldest-first), and after 3 attempts it resolves to `RISKY` (Task 4 test).
4. **A slow provider call runs past the 10 s budget.** In-flight checks may finish, but no new check starts after the budget (Task 4 test with a fake clock).
5. **Campaigns with no sequences, and archived subject variants.** Enabling auto-send on an empty campaign is allowed (LOW), and archived variants are never scored (Task 10 tests).

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20260926000000_deliverability_2a/migration.sql` | New enum and columns |
| `src/features/verification/provider.ts` | `VerifyOutcome`, `EmailVerifier`, `ProviderResult` types |
| `src/features/verification/server/millionverifier.ts` | MillionVerifier adapter + response interpretation |
| `src/features/verification/server/get-verifier.ts` | `getVerifier()`, `isVerificationConfigured()` |
| `src/features/verification/gate.ts` | Pure: result mapping, freshness, `verificationGate` |
| `src/features/verification/server/verify-leads.ts` | Worker + account-error alert |
| `src/features/verification/types.ts` | `VerificationSummaryDTO` |
| `src/features/verification/server/get-verification-summary.ts` | Counts for the Deliverability page |
| `src/features/verification/components/email-check-badge.tsx` | Lead badge |
| `src/features/verification/components/verification-card.tsx` | Deliverability card |
| `src/features/content-check/check-content.ts` | Pure content rules |
| `src/features/content-check/campaign-content.ts` | Pure: content items and campaign evaluation |
| `src/features/content-check/types.ts` | `ContentHighRiskError`, `ContentOverrideValidationError`, status DTO |
| `src/features/content-check/server/content-gate.ts` | Load, hash, gate, override, status |
| `src/features/content-check/components/content-risk.tsx` | Level badge + findings list |
| `src/features/content-check/components/campaign-content-panel.tsx` | Campaign page panel + override form |
| `src/app/api/campaigns/[id]/content-override/route.ts` | Override route |

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260926000000_deliverability_2a/migration.sql`
- Modify: `.env.example`

**Interfaces:**
- Produces:
  - Prisma enum `EmailCheck` (`UNCHECKED | PENDING | OK | RISKY | INVALID`)
  - `Lead.emailCheck`, `Lead.emailCheckResult`, `Lead.emailCheckedAt`, `Lead.emailCheckAttempts`
  - `Organization.blockRiskyEmails`, `Organization.verificationAlertedAt`, `Organization.verificationPausedReason`
  - `Campaign.contentOverrideReason`, `Campaign.contentOverrideBy`, `Campaign.contentOverrideAt`, `Campaign.contentOverrideHash`

- [ ] **Step 1: Edit the schema**

Add after `enum DomainStatus { … }`:

```prisma
enum EmailCheck {
  UNCHECKED
  PENDING
  OK
  RISKY
  INVALID
}
```

In `model Lead`, after `country String?`:

```prisma
  // Deliverability 2A: mailbox verification of `email` (MillionVerifier).
  emailCheck         EmailCheck @default(UNCHECKED)
  emailCheckResult   String?
  emailCheckedAt     DateTime?
  emailCheckAttempts Int        @default(0)
```

and add `@@index([emailCheck])` next to the other `@@index` lines of `Lead`.

In `model Organization`, after `allowCanadianRecipients Boolean @default(false)`:

```prisma
  // Deliverability 2A: send to catch-all/unknown addresses unless this is on.
  blockRiskyEmails         Boolean   @default(false)
  // Set when a verification outage (no credits / bad key) was alerted; cleared
  // after the next successful check. The reason is shown on Deliverability.
  verificationAlertedAt    DateTime?
  verificationPausedReason String?
```

In `model Campaign`, after `sampleApprovedAt DateTime?`:

```prisma
  // Deliverability 2A: a recorded override of a High content-risk score,
  // valid only while contentOverrideHash matches the current content.
  contentOverrideReason String?
  contentOverrideBy     String?
  contentOverrideAt     DateTime?
  contentOverrideHash   String?
```

- [ ] **Step 2: Write the migration**

`prisma/migrations/20260926000000_deliverability_2a/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "EmailCheck" AS ENUM ('UNCHECKED', 'PENDING', 'OK', 'RISKY', 'INVALID');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "emailCheck" "EmailCheck" NOT NULL DEFAULT 'UNCHECKED',
ADD COLUMN     "emailCheckAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailCheckResult" TEXT,
ADD COLUMN     "emailCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "blockRiskyEmails" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verificationAlertedAt" TIMESTAMP(3),
ADD COLUMN     "verificationPausedReason" TEXT;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "contentOverrideAt" TIMESTAMP(3),
ADD COLUMN     "contentOverrideBy" TEXT,
ADD COLUMN     "contentOverrideHash" TEXT,
ADD COLUMN     "contentOverrideReason" TEXT;

-- CreateIndex
CREATE INDEX "leads_emailCheck_idx" ON "leads"("emailCheck");
```

Append to `.env.example` (don't touch `.env`):

```
# Email verification (MillionVerifier). Leave empty to turn verification off.
MILLIONVERIFIER_API_KEY=
```

- [ ] **Step 3: Validate, apply to the dev DB, generate**

Run: `npx prisma validate && npx prisma migrate deploy && npx prisma migrate status && npx prisma generate`

Expected:
- The migration is applied.
- Status reports "Database schema is up to date".
- Generate succeeds.

`prisma.config.ts` uses `DIRECT_URL` from `.env`, which points at the Neon **dev** branch. Never point it at production.

Then confirm there's no drift: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script`. If the flag names differ in this Prisma version, check `npx prisma migrate diff --help` and use the equivalent. Expected: an empty script (a comment-only or "empty migration" output).

- [ ] **Step 4: Typecheck and full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS (no behavior changed yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260926000000_deliverability_2a .env.example
git commit -m "feat(deliverability-2a): schema for email verification and content override"
```

---

### Task 2: Verification provider and MillionVerifier adapter

**Files:**
- Create: `src/features/verification/provider.ts`
- Create: `src/features/verification/server/millionverifier.ts`
- Create: `src/features/verification/server/get-verifier.ts`
- Test: `src/features/verification/server/millionverifier.test.ts`

**Interfaces:**
- Produces:
  - `type ProviderResult = 'ok' | 'catch_all' | 'unknown' | 'invalid' | 'disposable'`
  - `type VerifyOutcome = { kind: 'result'; result: ProviderResult } | { kind: 'retry'; reason: string } | { kind: 'account'; reason: 'no_credits' | 'bad_key' }`
  - `interface EmailVerifier { verify(email: string): Promise<VerifyOutcome> }`
  - `interpretMillionVerifier(status: number, body: unknown): VerifyOutcome`
  - `createMillionVerifier(apiKey: string, fetchImpl?: typeof fetch): EmailVerifier`
  - `getVerifier(env?: NodeJS.ProcessEnv): EmailVerifier | null`
  - `isVerificationConfigured(env?: NodeJS.ProcessEnv): boolean`

- [ ] **Step 1: Write the failing test**

`src/features/verification/server/millionverifier.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { interpretMillionVerifier, createMillionVerifier } from './millionverifier'
import { getVerifier, isVerificationConfigured } from './get-verifier'

describe('interpretMillionVerifier', () => {
  it.each(['ok', 'catch_all', 'unknown', 'invalid', 'disposable'] as const)('maps result %s', (result) => {
    expect(interpretMillionVerifier(200, { email: 'a@b.com', result, resultcode: 1, error: '' })).toEqual({ kind: 'result', result })
  })

  it('treats result "error" and a missing result as retry', () => {
    expect(interpretMillionVerifier(200, { result: 'error', error: '' }).kind).toBe('retry')
    expect(interpretMillionVerifier(200, {}).kind).toBe('retry')
    expect(interpretMillionVerifier(200, null).kind).toBe('retry')
  })

  it('maps credit and key errors to account problems', () => {
    expect(interpretMillionVerifier(200, { error: 'Insufficient credits' })).toEqual({ kind: 'account', reason: 'no_credits' })
    expect(interpretMillionVerifier(200, { error: 'apikey not found' })).toEqual({ kind: 'account', reason: 'bad_key' })
    expect(interpretMillionVerifier(401, null)).toEqual({ kind: 'account', reason: 'bad_key' })
    expect(interpretMillionVerifier(402, null)).toEqual({ kind: 'account', reason: 'no_credits' })
  })

  it('treats other errors and 5xx as retry', () => {
    expect(interpretMillionVerifier(200, { error: 'temporary failure' })).toEqual({ kind: 'retry', reason: 'temporary failure' })
    expect(interpretMillionVerifier(503, null)).toEqual({ kind: 'retry', reason: 'HTTP 503' })
  })
})

describe('createMillionVerifier', () => {
  it('calls the v3 endpoint with the encoded key and email', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 'ok', error: '' }), { status: 200 }))
    const outcome = await createMillionVerifier('k&y', fetchImpl).verify('jane+1@acme.com')
    expect(outcome).toEqual({ kind: 'result', result: 'ok' })
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toBe('https://api.millionverifier.com/api/v3/?api=k%26y&email=jane%2B1%40acme.com&timeout=10')
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ signal: expect.any(AbortSignal) })
  })

  it('turns a network error or timeout into retry', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'))
    expect(await createMillionVerifier('k', fetchImpl).verify('a@b.com')).toEqual({ kind: 'retry', reason: 'The operation was aborted due to timeout' })
  })

  it('turns a non-JSON body into retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }))
    expect((await createMillionVerifier('k', fetchImpl).verify('a@b.com')).kind).toBe('retry')
  })
})

describe('getVerifier', () => {
  it('returns null and reports unconfigured when the key is unset or blank', () => {
    expect(getVerifier({} as NodeJS.ProcessEnv)).toBeNull()
    expect(isVerificationConfigured({ MILLIONVERIFIER_API_KEY: '  ' } as NodeJS.ProcessEnv)).toBe(false)
  })

  it('returns a verifier when the key is set', () => {
    expect(getVerifier({ MILLIONVERIFIER_API_KEY: 'k' } as NodeJS.ProcessEnv)).not.toBeNull()
    expect(isVerificationConfigured({ MILLIONVERIFIER_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/verification/server/millionverifier.test.ts`
Expected: FAIL. The modules don't exist yet.

- [ ] **Step 3: Implement**

`src/features/verification/provider.ts`:

```ts
// Provider-agnostic email verification contract. A verifier answers one
// address at a time; `account` outcomes (no credits, bad key) mean every
// further call would fail too, so the caller stops the whole run.

export type ProviderResult = 'ok' | 'catch_all' | 'unknown' | 'invalid' | 'disposable'

export type VerifyOutcome =
  | { kind: 'result'; result: ProviderResult }
  | { kind: 'retry'; reason: string }
  | { kind: 'account'; reason: 'no_credits' | 'bad_key' }

export interface EmailVerifier {
  verify(email: string): Promise<VerifyOutcome>
}
```

`src/features/verification/server/millionverifier.ts`:

```ts
import type { EmailVerifier, ProviderResult, VerifyOutcome } from '../provider'

const ENDPOINT = 'https://api.millionverifier.com/api/v3/'
export const CLIENT_TIMEOUT_MS = 15_000
const RESULTS: ReadonlySet<string> = new Set<ProviderResult>(['ok', 'catch_all', 'unknown', 'invalid', 'disposable'])

/** Map one MillionVerifier HTTP response to an outcome. Pure (tested with recorded shapes). */
export function interpretMillionVerifier(status: number, body: unknown): VerifyOutcome {
  if (status === 401 || status === 403) return { kind: 'account', reason: 'bad_key' }
  if (status === 402) return { kind: 'account', reason: 'no_credits' }
  const b = body && typeof body === 'object' ? (body as { result?: unknown; error?: unknown }) : null
  const error = typeof b?.error === 'string' ? b.error.trim() : ''
  if (error) {
    if (/credit/i.test(error)) return { kind: 'account', reason: 'no_credits' }
    if (/api\s?key|unauthori[sz]ed|forbidden/i.test(error)) return { kind: 'account', reason: 'bad_key' }
    return { kind: 'retry', reason: error }
  }
  if (status < 200 || status >= 300) return { kind: 'retry', reason: `HTTP ${status}` }
  const result = typeof b?.result === 'string' ? b.result : ''
  if (RESULTS.has(result)) return { kind: 'result', result: result as ProviderResult }
  return { kind: 'retry', reason: `result ${result || 'missing'}` }
}

export function createMillionVerifier(apiKey: string, fetchImpl: typeof fetch = fetch): EmailVerifier {
  return {
    async verify(email) {
      const url = `${ENDPOINT}?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&timeout=10`
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) })
        const body: unknown = await res.json().catch(() => null)
        return interpretMillionVerifier(res.status, body)
      } catch (err) {
        return { kind: 'retry', reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
```

`src/features/verification/server/get-verifier.ts`:

```ts
import type { EmailVerifier } from '../provider'
import { createMillionVerifier } from './millionverifier'

// One platform key for now (per-org keys are out of scope). No key means
// verification is off and sending behaves exactly as before.
export function isVerificationConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return !!env.MILLIONVERIFIER_API_KEY?.trim()
}

export function getVerifier(env: NodeJS.ProcessEnv = process.env): EmailVerifier | null {
  const key = env.MILLIONVERIFIER_API_KEY?.trim()
  return key ? createMillionVerifier(key) : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/verification/server/millionverifier.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/verification
git commit -m "feat(verification): provider interface and MillionVerifier adapter"
```

---

### Task 3: Verification gate (pure)

**Files:**
- Create: `src/features/verification/gate.ts`
- Test: `src/features/verification/gate.test.ts`

**Interfaces:**
- Consumes: `ProviderResult` (Task 2).
- Produces:
  - `VERIFY_MAX_AGE_DAYS = 90`
  - `MAX_VERIFY_ATTEMPTS = 3`
  - `checkFromResult(result: ProviderResult): 'OK' | 'RISKY' | 'INVALID'`
  - `interface GateLead { emailCheck: EmailCheck; emailCheckResult: string | null; emailCheckedAt: Date | null }`
  - `type GateDecision = { action: 'send' } | { action: 'wait' } | { action: 'stop'; reason: string }`
  - `isFreshResult(lead: GateLead, now?: Date): boolean`
  - `verificationGate(lead: GateLead, org: { blockRiskyEmails: boolean }, hasVerifier: boolean, now?: Date): GateDecision`

- [ ] **Step 1: Write the failing test**

`src/features/verification/gate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkFromResult, isFreshResult, verificationGate, VERIFY_MAX_AGE_DAYS } from './gate'

const NOW = new Date('2026-10-01T12:00:00Z')
const DAY = 86_400_000
const lead = (o: Partial<{ emailCheck: 'UNCHECKED' | 'PENDING' | 'OK' | 'RISKY' | 'INVALID'; emailCheckResult: string | null; emailCheckedAt: Date | null }> = {}) => ({
  emailCheck: 'OK' as const, emailCheckResult: 'ok', emailCheckedAt: new Date(NOW.getTime() - DAY), ...o,
})
const allowRisky = { blockRiskyEmails: false }
const blockRisky = { blockRiskyEmails: true }

describe('checkFromResult', () => {
  it.each([
    ['ok', 'OK'], ['catch_all', 'RISKY'], ['unknown', 'RISKY'], ['invalid', 'INVALID'], ['disposable', 'INVALID'],
  ] as const)('%s → %s', (result, check) => {
    expect(checkFromResult(result)).toBe(check)
  })
})

describe('verificationGate', () => {
  it('sends everything when no verifier is configured', () => {
    expect(verificationGate(lead({ emailCheck: 'UNCHECKED', emailCheckedAt: null }), allowRisky, false, NOW)).toEqual({ action: 'send' })
    expect(verificationGate(lead({ emailCheck: 'INVALID' }), allowRisky, false, NOW)).toEqual({ action: 'send' })
  })

  it('sends a fresh OK', () => {
    expect(verificationGate(lead(), allowRisky, true, NOW)).toEqual({ action: 'send' })
  })

  it('sends a fresh RISKY unless risky emails are blocked', () => {
    const risky = lead({ emailCheck: 'RISKY', emailCheckResult: 'catch_all' })
    expect(verificationGate(risky, allowRisky, true, NOW)).toEqual({ action: 'send' })
    expect(verificationGate(risky, blockRisky, true, NOW)).toEqual({
      action: 'stop', reason: 'Email is risky (catch-all/unknown) and risky emails are blocked',
    })
  })

  it('stops INVALID at any age, naming the result', () => {
    const old = lead({ emailCheck: 'INVALID', emailCheckResult: 'disposable', emailCheckedAt: new Date(NOW.getTime() - 400 * DAY) })
    expect(verificationGate(old, allowRisky, true, NOW)).toEqual({ action: 'stop', reason: 'Email failed verification (disposable)' })
  })

  it('waits on UNCHECKED, PENDING, and results older than 90 days', () => {
    expect(verificationGate(lead({ emailCheck: 'UNCHECKED', emailCheckedAt: null }), allowRisky, true, NOW)).toEqual({ action: 'wait' })
    expect(verificationGate(lead({ emailCheck: 'PENDING' }), allowRisky, true, NOW)).toEqual({ action: 'wait' })
    const stale = lead({ emailCheckedAt: new Date(NOW.getTime() - VERIFY_MAX_AGE_DAYS * DAY - 1) })
    expect(verificationGate(stale, allowRisky, true, NOW)).toEqual({ action: 'wait' })
  })

  it('treats exactly 90 days as still fresh', () => {
    const edge = lead({ emailCheckedAt: new Date(NOW.getTime() - VERIFY_MAX_AGE_DAYS * DAY) })
    expect(isFreshResult(edge, NOW)).toBe(true)
    expect(verificationGate(edge, allowRisky, true, NOW)).toEqual({ action: 'send' })
  })

  it('never treats PENDING or UNCHECKED as fresh even with a date', () => {
    expect(isFreshResult(lead({ emailCheck: 'PENDING' }), NOW)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/verification/gate.test.ts`
Expected: FAIL. The module doesn't exist yet.

- [ ] **Step 3: Implement**

`src/features/verification/gate.ts`:

```ts
import type { EmailCheck } from '@prisma/client'
import type { ProviderResult } from './provider'

export const VERIFY_MAX_AGE_DAYS = 90
export const MAX_VERIFY_ATTEMPTS = 3
const DAY_MS = 86_400_000

export function checkFromResult(result: ProviderResult): 'OK' | 'RISKY' | 'INVALID' {
  if (result === 'ok') return 'OK'
  if (result === 'catch_all' || result === 'unknown') return 'RISKY'
  return 'INVALID'
}

export interface GateLead {
  emailCheck: EmailCheck
  emailCheckResult: string | null
  emailCheckedAt: Date | null
}

export type GateDecision = { action: 'send' } | { action: 'wait' } | { action: 'stop'; reason: string }

/** A finished check (OK / RISKY / INVALID) no older than 90 days. */
export function isFreshResult(lead: GateLead, now: Date = new Date()): boolean {
  if (lead.emailCheck !== 'OK' && lead.emailCheck !== 'RISKY' && lead.emailCheck !== 'INVALID') return false
  if (!lead.emailCheckedAt) return false
  return now.getTime() - lead.emailCheckedAt.getTime() <= VERIFY_MAX_AGE_DAYS * DAY_MS
}

/**
 * May this lead get its FIRST email? Follow-ups are never gated.
 * `wait` means: make sure the lead is PENDING and try again later.
 */
export function verificationGate(
  lead: GateLead,
  org: { blockRiskyEmails: boolean },
  hasVerifier: boolean,
  now: Date = new Date(),
): GateDecision {
  if (!hasVerifier) return { action: 'send' }
  if (lead.emailCheck === 'INVALID') {
    return { action: 'stop', reason: `Email failed verification (${lead.emailCheckResult ?? 'invalid'})` }
  }
  if (!isFreshResult(lead, now)) return { action: 'wait' }
  if (lead.emailCheck === 'RISKY' && org.blockRiskyEmails) {
    return { action: 'stop', reason: 'Email is risky (catch-all/unknown) and risky emails are blocked' }
  }
  return { action: 'send' }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/verification/gate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/verification/gate.ts src/features/verification/gate.test.ts
git commit -m "feat(verification): pure send/wait/stop gate and result mapping"
```

---

### Task 4: Verification worker in the sequence runner

**Files:**
- Create: `src/features/verification/server/verify-leads.ts`
- Test: `src/features/verification/server/verify-leads.test.ts`
- Modify: `src/app/api/cron/sequence-runner/route.ts`
- Modify: `src/app/api/cron/sequence-runner/route.test.ts`

**Interfaces:**
- Consumes:
  - `EmailVerifier`, `VerifyOutcome` (Task 2)
  - `getVerifier()` (Task 2)
  - `checkFromResult`, `MAX_VERIFY_ATTEMPTS` (Task 3)
  - `sendOrgAlert(organizationId, subject, text): Promise<boolean>` from `@/features/replies/server/notify`
- Produces:
  - `VERIFY_BUDGET_MS = 10_000`
  - `VERIFY_CONCURRENCY = 5`
  - `interface VerifyRunResult { checked: number; retried: number; accountError: 'no_credits' | 'bad_key' | null; skipped: boolean }`
  - `verifyPendingLeads(budgetMs?: number, deps?: { verifier?: EmailVerifier | null; now?: () => number }): Promise<VerifyRunResult>`

- [ ] **Step 1: Write the failing test**

`src/features/verification/server/verify-leads.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findMany: vi.fn(), updateMany: vi.fn() },
    organization: { updateMany: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/features/replies/server/notify', () => ({ sendOrgAlert: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { verifyPendingLeads } from './verify-leads'
import type { EmailVerifier, VerifyOutcome } from '../provider'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { lead: { findMany: Fn; updateMany: Fn }; organization: { updateMany: Fn; update: Fn } }
const alert = sendOrgAlert as unknown as Fn
const T0 = new Date('2026-10-01T12:00:00Z').getTime()
const lead = (id: string, o: Record<string, unknown> = {}) => ({ id, organizationId: 'org-1', email: `${id}@acme.com`, emailCheckAttempts: 0, ...o })
const verifier = (fn: (email: string) => VerifyOutcome | Promise<VerifyOutcome>): EmailVerifier => ({ verify: vi.fn(async (e: string) => fn(e)) })

beforeEach(() => {
  vi.resetAllMocks()
  p.lead.updateMany.mockResolvedValue({ count: 1 })
  p.organization.updateMany.mockResolvedValue({ count: 1 })
  alert.mockResolvedValue(true)
})

describe('verifyPendingLeads', () => {
  it('skips entirely without a verifier', async () => {
    const res = await verifyPendingLeads(10_000, { verifier: null })
    expect(res).toEqual({ checked: 0, retried: 0, accountError: null, skipped: true })
    expect(p.lead.findMany).not.toHaveBeenCalled()
  })

  it('takes PENDING leads oldest-first and writes mapped results only while still PENDING (Review Focus #1, #3)', async () => {
    p.lead.findMany.mockResolvedValueOnce([lead('a'), lead('b'), lead('c')])
    const results: Record<string, VerifyOutcome> = {
      'a@acme.com': { kind: 'result', result: 'ok' },
      'b@acme.com': { kind: 'result', result: 'catch_all' },
      'c@acme.com': { kind: 'result', result: 'disposable' },
    }
    const res = await verifyPendingLeads(10_000, { verifier: verifier((e) => results[e]!), now: () => T0 })
    expect(p.lead.findMany.mock.calls[0]![0]).toMatchObject({ where: { emailCheck: 'PENDING' }, orderBy: { updatedAt: 'asc' } })
    expect(res.checked).toBe(3)
    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'a', emailCheck: 'PENDING' },
      data: { emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date(T0), emailCheckAttempts: 0 },
    })
    expect(p.lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b', emailCheck: 'PENDING' }, data: expect.objectContaining({ emailCheck: 'RISKY' }) }))
    expect(p.lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c', emailCheck: 'PENDING' }, data: expect.objectContaining({ emailCheck: 'INVALID', emailCheckResult: 'disposable' }) }))
  })

  it('counts a retry, and resolves to RISKY/unknown on the third attempt (Review Focus #3)', async () => {
    p.lead.findMany.mockResolvedValueOnce([lead('a', { emailCheckAttempts: 0 }), lead('b', { emailCheckAttempts: 2 })])
    const res = await verifyPendingLeads(10_000, { verifier: verifier(() => ({ kind: 'retry', reason: 'timeout' })), now: () => T0 })
    expect(res.retried).toBe(2)
    expect(p.lead.updateMany).toHaveBeenCalledWith({ where: { id: 'a', emailCheck: 'PENDING' }, data: { emailCheckAttempts: 1 } })
    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'b', emailCheck: 'PENDING' },
      data: { emailCheck: 'RISKY', emailCheckResult: 'unknown', emailCheckedAt: new Date(T0), emailCheckAttempts: 3 },
    })
  })

  it('never runs more than 5 checks at once', async () => {
    p.lead.findMany.mockResolvedValueOnce(Array.from({ length: 12 }, (_, i) => lead(`l${i}`)))
    let inFlight = 0
    let peak = 0
    const v = verifier(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return { kind: 'result', result: 'ok' }
    })
    const res = await verifyPendingLeads(10_000, { verifier: v })
    expect(res.checked).toBe(12)
    expect(peak).toBe(5)
  })

  it('starts no new check once the budget is spent, but lets in-flight ones finish (Review Focus #4)', async () => {
    p.lead.findMany.mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => lead(`l${i}`)))
    let clock = T0
    const v = verifier(() => {
      clock += 11_000 // each check "takes" 11 s
      return { kind: 'result', result: 'ok' }
    })
    const res = await verifyPendingLeads(10_000, { verifier: v, now: () => clock })
    // The first worker's check finishes past the budget; no worker starts another.
    expect((v.verify as Fn).mock.calls.length).toBeLessThanOrEqual(5)
    expect(res.checked).toBe((v.verify as Fn).mock.calls.length)
  })

  it('stops on an account error, leaves leads PENDING, and alerts each org with pending leads once', async () => {
    p.lead.findMany
      .mockResolvedValueOnce([lead('a'), lead('b', { organizationId: 'org-2' })])
      .mockResolvedValueOnce([{ organizationId: 'org-1' }, { organizationId: 'org-2' }])
    p.organization.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const v = verifier(() => ({ kind: 'account', reason: 'no_credits' }))
    const res = await verifyPendingLeads(10_000, { verifier: v, now: () => T0 })
    expect(res.accountError).toBe('no_credits')
    expect(p.lead.updateMany).not.toHaveBeenCalled()
    expect(p.lead.findMany.mock.calls[1]![0]).toMatchObject({ where: { emailCheck: 'PENDING' }, distinct: ['organizationId'] })
    expect(p.organization.updateMany).toHaveBeenCalledWith({
      where: { id: 'org-1', verificationAlertedAt: null },
      data: { verificationAlertedAt: new Date(T0), verificationPausedReason: 'out of MillionVerifier credits' },
    })
    // org-2 was already alerted for this outage (claim count 0): no second email.
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0]![0]).toBe('org-1')
    expect(alert.mock.calls[0]![1]).toBe('Email verification paused: out of MillionVerifier credits')
  })

  it('releases the alert claim when the alert email fails, so the next run retries it', async () => {
    p.lead.findMany.mockResolvedValueOnce([lead('a')]).mockResolvedValueOnce([{ organizationId: 'org-1' }])
    alert.mockResolvedValueOnce(false)
    await verifyPendingLeads(10_000, { verifier: verifier(() => ({ kind: 'account', reason: 'bad_key' })), now: () => T0 })
    expect(p.organization.update).toHaveBeenCalledWith({ where: { id: 'org-1' }, data: { verificationAlertedAt: null } })
  })

  it('clears an org\'s outage marker after a successful result', async () => {
    p.lead.findMany.mockResolvedValueOnce([lead('a')])
    await verifyPendingLeads(10_000, { verifier: verifier(() => ({ kind: 'result', result: 'ok' })), now: () => T0 })
    expect(p.organization.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['org-1'] }, verificationAlertedAt: { not: null } },
      data: { verificationAlertedAt: null, verificationPausedReason: null },
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/verification/server/verify-leads.test.ts`
Expected: FAIL. The module doesn't exist yet.

- [ ] **Step 3: Implement the worker**

`src/features/verification/server/verify-leads.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import type { EmailVerifier } from '../provider'
import { checkFromResult, MAX_VERIFY_ATTEMPTS } from '../gate'
import { getVerifier } from './get-verifier'

export const VERIFY_BUDGET_MS = 10_000
export const VERIFY_CONCURRENCY = 5
const BATCH = 50

export interface VerifyRunResult {
  checked: number
  retried: number
  accountError: 'no_credits' | 'bad_key' | null
  skipped: boolean
}

interface Deps {
  verifier?: EmailVerifier | null
  now?: () => number
}

const PAUSED_REASON = {
  no_credits: 'out of MillionVerifier credits',
  bad_key: 'the MillionVerifier API key was rejected',
} as const

/**
 * Resolve PENDING leads, oldest first, within a time budget. Every write is
 * conditional on the lead still being PENDING, so a bounce that marks it
 * INVALID mid-check is never overwritten.
 */
export async function verifyPendingLeads(budgetMs = VERIFY_BUDGET_MS, deps: Deps = {}): Promise<VerifyRunResult> {
  const verifier = deps.verifier === undefined ? getVerifier() : deps.verifier
  const clock = deps.now ?? Date.now
  const result: VerifyRunResult = { checked: 0, retried: 0, accountError: null, skipped: false }
  if (!verifier) return { ...result, skipped: true }

  const startedAt = clock()
  const leads = await prisma.lead.findMany({
    where: { emailCheck: 'PENDING' },
    orderBy: { updatedAt: 'asc' },
    take: BATCH,
    select: { id: true, organizationId: true, email: true, emailCheckAttempts: true },
  })

  const succeededOrgs = new Set<string>()
  let next = 0

  async function worker(v: EmailVerifier) {
    while (next < leads.length && !result.accountError && clock() - startedAt < budgetMs) {
      const lead = leads[next++]!
      const outcome = await v.verify(lead.email)
      if (outcome.kind === 'account') {
        result.accountError ??= outcome.reason
        return
      }
      const where = { id: lead.id, emailCheck: 'PENDING' as const }
      if (outcome.kind === 'result') {
        await prisma.lead.updateMany({
          where,
          data: {
            emailCheck: checkFromResult(outcome.result),
            emailCheckResult: outcome.result,
            emailCheckedAt: new Date(clock()),
            emailCheckAttempts: 0,
          },
        })
        result.checked++
        succeededOrgs.add(lead.organizationId)
        continue
      }
      const attempts = lead.emailCheckAttempts + 1
      await prisma.lead.updateMany({
        where,
        data:
          attempts >= MAX_VERIFY_ATTEMPTS
            ? { emailCheck: 'RISKY', emailCheckResult: 'unknown', emailCheckedAt: new Date(clock()), emailCheckAttempts: attempts }
            : { emailCheckAttempts: attempts },
      })
      result.retried++
    }
  }

  await Promise.all(Array.from({ length: Math.min(VERIFY_CONCURRENCY, leads.length) }, () => worker(verifier)))

  if (succeededOrgs.size > 0) {
    await prisma.organization.updateMany({
      where: { id: { in: [...succeededOrgs] }, verificationAlertedAt: { not: null } },
      data: { verificationAlertedAt: null, verificationPausedReason: null },
    })
  }
  if (result.accountError) await alertPaused(result.accountError, new Date(clock()))
  return result
}

// One alert per org per outage: claim verificationAlertedAt atomically, and
// release it if the email couldn't be sent so the next run retries.
async function alertPaused(reason: 'no_credits' | 'bad_key', now: Date): Promise<void> {
  const orgs = await prisma.lead.findMany({
    where: { emailCheck: 'PENDING' },
    distinct: ['organizationId'],
    select: { organizationId: true },
  })
  for (const { organizationId } of orgs) {
    const claim = await prisma.organization.updateMany({
      where: { id: organizationId, verificationAlertedAt: null },
      data: { verificationAlertedAt: now, verificationPausedReason: PAUSED_REASON[reason] },
    })
    if (claim.count !== 1) continue
    const ok = await sendOrgAlert(
      organizationId,
      `Email verification paused: ${PAUSED_REASON[reason]}`,
      `New leads' first emails are waiting until their addresses can be verified. ${
        reason === 'no_credits'
          ? 'Add MillionVerifier credits'
          : 'Check MILLIONVERIFIER_API_KEY in the Vercel project settings'
      }; verification resumes automatically on the next run. Nothing is sent to unverified addresses in the meantime.`,
    )
    if (!ok) await prisma.organization.update({ where: { id: organizationId }, data: { verificationAlertedAt: null } })
  }
}
```

- [ ] **Step 4: Run the worker test**

Run: `npx vitest run src/features/verification/server/verify-leads.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the runner route test (failing)**

In `src/app/api/cron/sequence-runner/route.test.ts`:

1. Add this mock beside the existing `vi.mock` calls:

```ts
vi.mock('@/features/verification/server/verify-leads', () => ({
  verifyPendingLeads: vi.fn(),
  VERIFY_BUDGET_MS: 10_000,
}))
```

2. Add `import { verifyPendingLeads } from '@/features/verification/server/verify-leads'`, with `const mockVerify = verifyPendingLeads as ReturnType<typeof vi.fn>`.

3. In `beforeEach`, add `mockVerify.mockResolvedValue({ checked: 0, retried: 0, accountError: null, skipped: true })`.

4. Add these tests inside the existing `describe`, following the file's existing authorized-request pattern (reuse whatever helper sets up `findMany`/`updateMany` for an empty run):

```ts
  it('verifies pending leads with a 10 s budget before querying due enrollments', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })
    mockFindMany.mockResolvedValue([])
    const order: string[] = []
    mockVerify.mockImplementation(async () => { order.push('verify'); return { checked: 2, retried: 0, accountError: null, skipped: false } })
    mockFindMany.mockImplementation(async () => { order.push('due'); return [] })
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    expect(mockVerify).toHaveBeenCalledWith(10_000)
    expect(order).toEqual(['verify', 'due'])
    expect((await res.json()).verification).toMatchObject({ checked: 2 })
  })

  it('still processes enrollments when verification throws', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockFindMany.mockResolvedValue([{ id: 'e1' }])
    mockRunSequenceStep.mockResolvedValue('DRAFT_GENERATED')
    mockVerify.mockRejectedValue(new Error('db down'))
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(mockRunSequenceStep).toHaveBeenCalledWith({ enrollmentId: 'e1' })
  })
```

Run: `npx vitest run src/app/api/cron/sequence-runner/route.test.ts`
Expected: the two new tests FAIL.

- [ ] **Step 6: Wire the worker into the route**

In `src/app/api/cron/sequence-runner/route.ts`:
- Add the import `import { verifyPendingLeads, VERIFY_BUDGET_MS, type VerifyRunResult } from '@/features/verification/server/verify-leads'`.
- Declare `let verification: VerifyRunResult | { error: string } | null = null` next to `let outOfBudget = false`.
- Insert this block right after the stale-lock recovery (`// 1. Recover stale locks` … `updateMany(...)`) and before `// 2. Query due enrollments`:

```ts
    // 1b. Verify pending lead emails first (up to 10 s of the 25 s budget) so a
    //     lead verified now can get its first email in this same tick. Never
    //     let a verification failure stop step processing.
    try {
      verification = await verifyPendingLeads(VERIFY_BUDGET_MS)
    } catch (err) {
      console.error('[sequence-runner] verification failed', err)
      verification = { error: err instanceof Error ? err.message : String(err) }
    }
```

Add `verification,` to the returned JSON object, after `staleLockRecovery: true,`.

- [ ] **Step 7: Run the route and worker tests**

Run: `npx vitest run src/app/api/cron/sequence-runner src/features/verification`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/verification/server/verify-leads.ts src/features/verification/server/verify-leads.test.ts src/app/api/cron/sequence-runner
git commit -m "feat(verification): background worker in the sequence runner with outage alerts"
```

---

### Task 5: Enrollment queueing, step-1 gate, bounce feedback

**Files:**
- Modify: `src/features/sequences/server/enroll-lead.ts`
- Modify: `src/features/sequences/server/enroll-lead.test.ts`
- Modify: `src/features/sequences/server/run-sequence-step.ts`
- Modify: `src/features/sequences/server/run-sequence-step.test.ts`
- Modify: `src/features/inbox/server/monitor-mailboxes.ts`
- Modify: `src/features/inbox/server/monitor-mailboxes.test.ts`

**Interfaces:**
- Consumes:
  - `isFreshResult`, `verificationGate` (Task 3)
  - `isVerificationConfigured` (Task 2)
- Produces: `VERIFY_WAIT_MS = 10 * 60 * 1000`, exported from `run-sequence-step.ts`.

- [ ] **Step 1: Write the failing enrollment tests**

In `enroll-lead.test.ts`:
- Add `lead: { findFirst: vi.fn(), updateMany: vi.fn() }` to the prisma mock (replacing the current `lead` entry).
- Add `import { afterEach } from 'vitest'`, merged into the existing import.
- Add the tests below. They reuse the file's existing "creates enrollment with correct nextDueAt" setup: `mockTransaction` runs the callback with a `tx` that has `sequenceEnrollment.create` and `auditLog.create`. Add `lead: { updateMany: txLeadUpdateMany }` to that `tx` object.

```ts
describe('enrollLead — email verification queueing', () => {
  const baseLead = { id: 'lead-1', status: 'NEW', email: 'a@acme.com', phone: null, country: null, customFields: null, organization: { allowCanadianRecipients: false } }
  let txLeadUpdateMany: ReturnType<typeof vi.fn>

  function setup(leadOverrides: Record<string, unknown>) {
    mockLeadFind.mockResolvedValue({ ...baseLead, ...leadOverrides })
    mockSeqFind.mockResolvedValue({ id: 'seq-1', steps: [{ stepNumber: 1, delayDays: 0 }] })
    mockEnrollFind.mockResolvedValue(null)
    txLeadUpdateMany = vi.fn().mockResolvedValue({ count: 1 })
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        sequenceEnrollment: { create: vi.fn().mockResolvedValue({ id: 'enr-1' }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
        lead: { updateMany: txLeadUpdateMany },
      }),
    )
  }

  beforeEach(() => { process.env.MILLIONVERIFIER_API_KEY = 'test-key' })
  afterEach(() => { delete process.env.MILLIONVERIFIER_API_KEY })

  it('queues an unchecked lead for verification', async () => {
    setup({ emailCheck: 'UNCHECKED', emailCheckResult: null, emailCheckedAt: null })
    await enrollLead(BASE_INPUT)
    expect(txLeadUpdateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', emailCheck: { not: 'PENDING' } },
      data: { emailCheck: 'PENDING', emailCheckAttempts: 0 },
    })
  })

  it('does not re-queue a lead verified within 90 days', async () => {
    setup({ emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date(Date.now() - 5 * 86_400_000) })
    await enrollLead(BASE_INPUT)
    expect(txLeadUpdateMany).not.toHaveBeenCalled()
  })

  it('re-queues a result older than 90 days', async () => {
    setup({ emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date(Date.now() - 91 * 86_400_000) })
    await enrollLead(BASE_INPUT)
    expect(txLeadUpdateMany).toHaveBeenCalled()
  })

  it('does nothing when verification is not configured', async () => {
    delete process.env.MILLIONVERIFIER_API_KEY
    setup({ emailCheck: 'UNCHECKED', emailCheckResult: null, emailCheckedAt: null })
    await enrollLead(BASE_INPUT)
    expect(txLeadUpdateMany).not.toHaveBeenCalled()
  })
})
```

Also add `emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date()` to the lead objects used by the file's existing tests, so they keep their current behavior.

- [ ] **Step 2: Run the enrollment tests to verify they fail**

Run: `npx vitest run src/features/sequences/server/enroll-lead.test.ts`
Expected: FAIL on the "queues" and "re-queues" tests.

- [ ] **Step 3: Implement the enrollment queueing**

In `enroll-lead.ts`:
- Add the imports `import { isFreshResult } from '@/features/verification/gate'` and `import { isVerificationConfigured } from '@/features/verification/server/get-verifier'`.
- Add `emailCheck: true, emailCheckResult: true, emailCheckedAt: true,` to the lead `select`.
- Inside the `$transaction` callback, after `tx.auditLog.create(...)` and before `return created`, add:

```ts
    // Deliverability 2A: verify the address before the first email, unless a
    // result from the last 90 days already exists. Only when verification is
    // configured — otherwise the lead would show "Verifying" forever.
    if (isVerificationConfigured() && !isFreshResult(lead, now)) {
      await tx.lead.updateMany({
        where: { id: leadId, emailCheck: { not: 'PENDING' } },
        data: { emailCheck: 'PENDING', emailCheckAttempts: 0 },
      })
    }
```

- [ ] **Step 4: Write the failing runner tests**

In `run-sequence-step.test.ts`:
- Add `lead: { updateMany: vi.fn() }` to the prisma mock.
- Add `blockRiskyEmails: false` to `makeEnrollment`'s `organization`.
- Add `emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date()` to its `lead`.
- Add `import { afterEach } from 'vitest'`, merged into the existing import.
- Then add:

```ts
describe('runSequenceStep — email verification gate (first step only)', () => {
  const mockLeadUpdateMany = prisma.lead.updateMany as ReturnType<typeof vi.fn>
  const mockEnrollmentUpdate = prisma.sequenceEnrollment.update as ReturnType<typeof vi.fn>

  beforeEach(() => {
    process.env.MILLIONVERIFIER_API_KEY = 'test-key'
    mockCheckStop.mockResolvedValue({ shouldStop: false })
    mockEnrollmentUpdate.mockResolvedValue({})
    mockLeadUpdateMany.mockResolvedValue({ count: 1 })
  })
  afterEach(() => { delete process.env.MILLIONVERIFIER_API_KEY })

  it('defers step 1 by 10 minutes while the lead is PENDING, without drafting', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ lead: { ...makeEnrollment().lead, emailCheck: 'PENDING', emailCheckedAt: null } }))
    const { draftCreate } = txFake()
    const before = Date.now()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
    const next = (mockEnrollmentUpdate.mock.calls[0]![0] as { data: { nextDueAt: Date } }).data.nextDueAt.getTime()
    expect(next - before).toBeGreaterThanOrEqual(10 * 60 * 1000)
    expect(next - before).toBeLessThan(11 * 60 * 1000)
    expect(draftCreate).not.toHaveBeenCalled()
    expect(personalize).not.toHaveBeenCalled()
  })

  it('queues an UNCHECKED lead (enrolled before verification existed) and waits (Review Focus #2)', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ lead: { ...makeEnrollment().lead, emailCheck: 'UNCHECKED', emailCheckResult: null, emailCheckedAt: null } }))
    txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('DEFERRED')
    expect(mockLeadUpdateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', emailCheck: { not: 'PENDING' } },
      data: { emailCheck: 'PENDING', emailCheckAttempts: 0 },
    })
  })

  it('stops the enrollment on an INVALID address', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ lead: { ...makeEnrollment().lead, emailCheck: 'INVALID', emailCheckResult: 'invalid' } }))
    const { draftCreate } = txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('STOPPED')
    expect(mockEnrollmentUpdate).toHaveBeenCalledWith({
      where: { id: 'enroll-1' },
      data: expect.objectContaining({ status: 'STOPPED', stoppedReason: 'Email failed verification (invalid)', processing: false }),
    })
    expect(draftCreate).not.toHaveBeenCalled()
  })

  it('stops a RISKY address when the org blocks risky emails', async () => {
    const e = makeEnrollment()
    mockEnrollmentFind.mockResolvedValue({ ...e, lead: { ...e.lead, emailCheck: 'RISKY', emailCheckResult: 'catch_all' }, organization: { ...e.organization, blockRiskyEmails: true } })
    txFake()
    expect(await runSequenceStep({ enrollmentId: 'enroll-1' })).toBe('STOPPED')
  })

  it('does not gate follow-up steps', async () => {
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ currentStepNumber: 1, lead: { ...makeEnrollment().lead, emailCheck: 'PENDING', emailCheckedAt: null } }))
    const { draftCreate } = txFake()
    const result = await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(result).not.toBe('DEFERRED')
    expect(draftCreate).toHaveBeenCalled()
  })

  it('is a no-op when verification is not configured', async () => {
    delete process.env.MILLIONVERIFIER_API_KEY
    mockEnrollmentFind.mockResolvedValue(makeEnrollment({ lead: { ...makeEnrollment().lead, emailCheck: 'UNCHECKED', emailCheckedAt: null } }))
    const { draftCreate } = txFake()
    await runSequenceStep({ enrollmentId: 'enroll-1' })
    expect(draftCreate).toHaveBeenCalled()
  })
})
```

The "does not gate follow-up steps" test relies on the non-auto-send campaign path generating a draft for step 2. If step 2 on the manual path needs extra mocks (e.g. `draft.findFirst` for the previous step), copy the setup of the existing test "returns DRAFT_GENERATED on successful step execution" with `currentStepNumber: 1`.

- [ ] **Step 5: Run the runner tests to verify they fail**

Run: `npx vitest run src/features/sequences/server/run-sequence-step.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 6: Implement the step-1 gate**

In `run-sequence-step.ts`:
- Add the imports `import { verificationGate } from '@/features/verification/gate'` and `import { isVerificationConfigured } from '@/features/verification/server/get-verifier'`.
- Add `export const VERIFY_WAIT_MS = 10 * 60 * 1000` under `AI_RETRY_MS`.
- Extend the `lead` select with `emailCheck: true, emailCheckResult: true, emailCheckedAt: true`, and the `organization` select with `blockRiskyEmails: true`.
- Then insert this right after the `if (!nextStep) { … return 'COMPLETED' }` block and before `const campaign = enrollment.sequence.campaign`:

```ts
  // 3b. Email verification gate — FIRST email only, before any AI spend.
  //     `wait` pushes nextDueAt so waiting enrollments don't fill the
  //     runner's oldest-first batch and starve due follow-ups.
  if (nextStepNumber === 1) {
    const decision = verificationGate(enrollment.lead, enrollment.organization, isVerificationConfigured())
    if (decision.action === 'stop') {
      await prisma.sequenceEnrollment.update({
        where: { id: enrollmentId },
        data: { status: 'STOPPED', stoppedAt: new Date(), stoppedReason: decision.reason, processing: false },
      })
      return 'STOPPED'
    }
    if (decision.action === 'wait') {
      if (enrollment.lead.emailCheck !== 'PENDING') {
        await prisma.lead.updateMany({
          where: { id: enrollment.lead.id, emailCheck: { not: 'PENDING' } },
          data: { emailCheck: 'PENDING', emailCheckAttempts: 0 },
        })
      }
      return defer(enrollmentId, VERIFY_WAIT_MS)
    }
  }
```

- [ ] **Step 7: Write the failing bounce-feedback test**

In `monitor-mailboxes.test.ts`, change the prisma mock's `lead` entry to `lead: { findFirst: vi.fn(), updateMany: vi.fn() }`. Then, in the existing test `'bounce: records BOUNCED event, bounces the lead, stops, and evaluates the breaker'`, add after its existing expectations:

```ts
    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-9' },
      data: { emailCheck: 'INVALID', emailCheckResult: 'bounced', emailCheckedAt: expect.any(Date) },
    })
```

(`p` is the file's typed prisma mock. If its type lacks `lead.updateMany`, add it to that type.)

Run: `npx vitest run src/features/inbox/server/monitor-mailboxes.test.ts`
Expected: FAIL on that expectation.

- [ ] **Step 8: Implement the bounce feedback**

In `monitor-mailboxes.ts`, inside `if (kind === 'BOUNCE') { … }`, right after the `await transitionLeadStatus({ … newStatus: 'BOUNCED' … })` call, add:

```ts
    // Deliverability 2A: a real bounce is the strongest verification result —
    // mark the address INVALID so it is never enrolled and emailed again.
    await prisma.lead.updateMany({
      where: { id: original.leadId },
      data: { emailCheck: 'INVALID', emailCheckResult: 'bounced', emailCheckedAt: new Date() },
    })
```

- [ ] **Step 9: Run the three test files, then the suite**

Run: `npx vitest run src/features/sequences src/features/inbox && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/features/sequences/server/enroll-lead.ts src/features/sequences/server/enroll-lead.test.ts src/features/sequences/server/run-sequence-step.ts src/features/sequences/server/run-sequence-step.test.ts src/features/inbox/server/monitor-mailboxes.ts src/features/inbox/server/monitor-mailboxes.test.ts
git commit -m "feat(verification): queue on enrollment, gate the first step, bounces mark INVALID"
```

---

### Task 6: Manual Send gate

**Files:**
- Modify: `src/features/messages/types.ts`
- Modify: `src/features/messages/server/send-draft.ts`
- Modify: `src/features/messages/server/send-draft.test.ts`
- Modify: `src/app/api/drafts/[id]/send/route.ts`
- Test: the route's existing test file, if there is one (`src/app/api/drafts/[id]/send/route.test.ts`)

**Interfaces:**
- Consumes: `verificationGate` (Task 3), `isVerificationConfigured` (Task 2).
- Produces: `class EmailNotVerifiedError extends Error { state: 'wait' | 'stop' }`, exported from `src/features/messages/types.ts`.

- [ ] **Step 1: Write the failing tests**

In `send-draft.test.ts`:
- Add `findFirst: vi.fn()` to the `outboundMessage` mock and to the `mockPrisma` type.
- Add `lead: { updateMany: vi.fn() }` to the prisma mock and type.
- Import `EmailNotVerifiedError` from `@/features/messages/types`.
- Import `afterEach`.
- Add:

```ts
describe('sendDraft — email verification gate (first email to a lead)', () => {
  beforeEach(() => { process.env.MILLIONVERIFIER_API_KEY = 'test-key' })
  afterEach(() => { delete process.env.MILLIONVERIFIER_API_KEY })

  function setupFirstEmail(lead: Record<string, unknown>, org: Record<string, unknown> = {}) {
    mockPrisma.draft.findFirst.mockResolvedValue({ ...fakeDraft, lead: { ...fakeDraft.lead, ...lead } })
    mockPrisma.outboundMessage.findUnique.mockResolvedValue(null)
    mockPrisma.organization.findUnique.mockResolvedValue({ msTenantId: null, businessName: 'Acme', postalAddress: '1 Main St, Buffalo, NY 14201', allowCanadianRecipients: false, blockRiskyEmails: false, ...org })
    mockPrisma.outboundMessage.findFirst.mockResolvedValue(null) // never emailed before
    ;(prisma as unknown as { lead: { updateMany: Fn } }).lead.updateMany.mockResolvedValue({ count: 1 })
  }

  it('refuses a first email to an unverified lead and queues it', async () => {
    setupFirstEmail({ emailCheck: 'UNCHECKED', emailCheckResult: null, emailCheckedAt: null })
    const err = await sendDraft(INPUT).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EmailNotVerifiedError)
    expect((err as EmailNotVerifiedError).state).toBe('wait')
    expect((prisma as unknown as { lead: { updateMany: Fn } }).lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', emailCheck: { not: 'PENDING' } },
      data: { emailCheck: 'PENDING', emailCheckAttempts: 0 },
    })
    expect(mockPrisma.mailbox.findMany).not.toHaveBeenCalled()
  })

  it('refuses an INVALID lead with the reason', async () => {
    setupFirstEmail({ emailCheck: 'INVALID', emailCheckResult: 'invalid', emailCheckedAt: new Date() })
    await expect(sendDraft(INPUT)).rejects.toThrow('Email failed verification (invalid)')
  })

  it('does not gate a lead that was emailed before (follow-up)', async () => {
    setupFirstEmail({ emailCheck: 'UNCHECKED', emailCheckResult: null, emailCheckedAt: null })
    mockPrisma.outboundMessage.findFirst.mockResolvedValue({ id: 'om-old' })
    const err = await sendDraft(INPUT).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(EmailNotVerifiedError)
  })
})
```

The "does not gate" test only asserts that the gate is not the error. It may still fail later for lack of mailbox mocks.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/messages/server/send-draft.test.ts`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

Append to `src/features/messages/types.ts`:

```ts
// Deliverability 2A: a lead's first email waits for (or is refused by) email
// verification. `wait` = being verified, try again shortly; `stop` = invalid or
// risky-and-blocked.
export class EmailNotVerifiedError extends Error {
  constructor(public readonly state: 'wait' | 'stop', message: string) {
    super(message)
    this.name = 'EmailNotVerifiedError'
    Object.setPrototypeOf(this, EmailNotVerifiedError.prototype)
  }
}
```

In `send-draft.ts`:
- Import `EmailNotVerifiedError` with the other `../types` imports.
- Add `import { verificationGate } from '@/features/verification/gate'` and `import { isVerificationConfigured } from '@/features/verification/server/get-verifier'`.
- Extend the draft's `lead` select with `emailCheck: true, emailCheckResult: true, emailCheckedAt: true`.
- Extend the `organization.findUnique` select with `blockRiskyEmails: true`.
- Insert this right after the CASL check (`if (!org.allowCanadianRecipients) { … }`) and before the `// THREADING` comment:

```ts
  // 2e. Email verification (first email to this lead only).
  if (isVerificationConfigured()) {
    const emailedBefore = await prisma.outboundMessage.findFirst({
      where: { organizationId, leadId: draft.leadId, sentAt: { not: null } },
      select: { id: true },
    })
    if (!emailedBefore) {
      const decision = verificationGate(draft.lead, { blockRiskyEmails: org.blockRiskyEmails }, true)
      if (decision.action === 'stop') throw new EmailNotVerifiedError('stop', decision.reason)
      if (decision.action === 'wait') {
        await prisma.lead.updateMany({
          where: { id: draft.leadId, emailCheck: { not: 'PENDING' } },
          data: { emailCheck: 'PENDING', emailCheckAttempts: 0 },
        })
        throw new EmailNotVerifiedError('wait', "This lead's email address is being verified. Try again in a few minutes.")
      }
    }
  }
```

In `src/app/api/drafts/[id]/send/route.ts`, import `EmailNotVerifiedError` and add this beside the `DomainNotHealthyError` branch:

```ts
    if (err instanceof EmailNotVerifiedError) {
      return NextResponse.json({ code: 'EMAIL_NOT_VERIFIED', error: err.message, state: err.state }, { status: 422 })
    }
```

If `route.test.ts` exists for this route, add a test: when `sendDraft` rejects with `new EmailNotVerifiedError('stop', 'Email failed verification (invalid)')`, the route returns 422 with `code: 'EMAIL_NOT_VERIFIED'`. Mirror its existing `DOMAIN_NOT_HEALTHY` test.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/messages src/app/api/drafts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/messages src/app/api/drafts
git commit -m "feat(verification): manual Send refuses unverified first emails (422 EMAIL_NOT_VERIFIED)"
```

---

### Task 7: "Block risky emails" setting

**Files:**
- Modify: `src/features/settings/server/sending-settings.ts`
- Modify: `src/app/api/settings/sending/route.ts`
- Modify: `src/features/settings/components/sending-settings-form.tsx`
- Test: `src/features/settings/components/sending-settings-form.test.tsx`
- Test: `src/features/settings/server/sending-settings.test.ts`, if it exists

**Interfaces:**
- Produces: `SendingSettingsDTO.blockRiskyEmails: boolean`, settable via `PATCH /api/settings/sending` `{ blockRiskyEmails: boolean }`.

- [ ] **Step 1: Write the failing form test**

In `sending-settings-form.test.tsx`, add `blockRiskyEmails: false` to the `initial` fixture, then add:

```ts
  it('saves the block-risky-emails toggle', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...initial, blockRiskyEmails: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    render(<SendingSettingsForm initial={initial} />)
    fireEvent.click(screen.getByLabelText(/Block risky emails/))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string)
    expect(body).toMatchObject({ blockRiskyEmails: true })
  })
```

Match the file's existing Canada-toggle test for how the form is rendered and saved: component name, props, and the save button's name. Adjust those three to match.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/settings`
Expected: FAIL.

- [ ] **Step 3: Implement**

`sending-settings.ts`:
- Add `blockRiskyEmails: boolean` to `SendingSettingsDTO`, after `allowCanadianRecipients`.
- Add `blockRiskyEmails: true` to `SELECT`.
- In `updateSendingSettings`, after the `allowCanadianRecipients` line, add:

```ts
  if (patch.blockRiskyEmails !== undefined) data.blockRiskyEmails = patch.blockRiskyEmails
```

In `route.ts`, change `BOOLEAN_FIELDS` to `new Set(['sendingPaused', 'allowCanadianRecipients', 'blockRiskyEmails'])`.

`sending-settings-form.tsx`:
- Add `const [blockRisky, setBlockRisky] = useState(initial.blockRiskyEmails)` beside `allowCanadian`.
- Add `blockRiskyEmails: blockRisky,` to the save payload, after `allowCanadianRecipients: allowCanadian,`.
- Add this label right after the Canada `<label>…</label>`:

```tsx
        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={blockRisky}
            onChange={(e) => setBlockRisky(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Block risky emails (catch-all / unknown). Off by default: these addresses can&apos;t be confirmed, so some
            will bounce. Turn this on if your bounce rate climbs.
          </span>
        </label>
```

Fix every other place that builds a full `SendingSettingsDTO` (fixtures, the settings page), so that `npx tsc --noEmit` is clean.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/settings src/app/api/settings && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings src/app/api/settings
git commit -m "feat(verification): org setting to block risky (catch-all/unknown) emails"
```

---

### Task 8: Verification UI (lead badge, Deliverability card)

**Files:**
- Create: `src/features/verification/types.ts`
- Create: `src/features/verification/server/get-verification-summary.ts`
- Test: `src/features/verification/server/get-verification-summary.test.ts`
- Create: `src/features/verification/components/email-check-badge.tsx`
- Create: `src/features/verification/components/verification-card.tsx`
- Test: `src/features/verification/components/verification-ui.test.tsx`
- Modify:
  - `src/features/leads/types.ts`
  - `src/features/leads/server/get-leads.ts`
  - `src/features/leads/server/get-lead.ts`
  - `src/features/leads/components/leads-table.tsx`
  - `src/features/leads/components/lead-header.tsx`
  - `src/app/(dashboard)/deliverability/page.tsx`
  - `src/features/deliverability/components/deliverability-client.tsx`

**Interfaces:**
- Consumes: `isVerificationConfigured` (Task 2).
- Produces:
  - `interface VerificationSummaryDTO { configured: boolean; pending: number; risky: number; invalid: number; pausedReason: string | null }`
  - `getVerificationSummary(organizationId: string): Promise<VerificationSummaryDTO>`
  - `<EmailCheckBadge check result checkedAt />`
  - `<VerificationCard summary />`
  - `DeliverabilityClient` gains an optional prop `verification?: VerificationSummaryDTO`.

- [ ] **Step 1: Write the failing tests**

`src/features/verification/server/get-verification-summary.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { lead: { count: vi.fn() }, organization: { findUniqueOrThrow: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { getVerificationSummary } from './get-verification-summary'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { lead: { count: Fn }; organization: { findUniqueOrThrow: Fn } }

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MILLIONVERIFIER_API_KEY = 'k'
})
afterEach(() => { delete process.env.MILLIONVERIFIER_API_KEY })

describe('getVerificationSummary', () => {
  it('counts pending, risky and invalid among enrolled leads and returns the paused reason', async () => {
    p.lead.count.mockImplementation(async ({ where }: { where: { emailCheck: string } }) => ({ PENDING: 4, RISKY: 2, INVALID: 1 })[where.emailCheck] ?? 0)
    p.organization.findUniqueOrThrow.mockResolvedValue({ verificationPausedReason: 'out of MillionVerifier credits' })
    expect(await getVerificationSummary('org-1')).toEqual({ configured: true, pending: 4, risky: 2, invalid: 1, pausedReason: 'out of MillionVerifier credits' })
    expect(p.lead.count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', sequenceEnrollments: { some: {} }, emailCheck: 'PENDING' } })
  })

  it('reports unconfigured without a key', async () => {
    delete process.env.MILLIONVERIFIER_API_KEY
    p.lead.count.mockResolvedValue(0)
    p.organization.findUniqueOrThrow.mockResolvedValue({ verificationPausedReason: null })
    expect((await getVerificationSummary('org-1')).configured).toBe(false)
  })
})
```

`src/features/verification/components/verification-ui.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmailCheckBadge } from './email-check-badge'
import { VerificationCard } from './verification-card'

describe('EmailCheckBadge', () => {
  it.each([
    ['UNCHECKED', 'Not checked'], ['PENDING', 'Verifying'], ['OK', 'Verified'], ['RISKY', 'Risky'], ['INVALID', 'Invalid'],
  ] as const)('%s renders "%s"', (check, label) => {
    render(<EmailCheckBadge check={check} result={null} checkedAt={null} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('names the result for screen readers', () => {
    render(<EmailCheckBadge check="RISKY" result="catch_all" checkedAt="2026-09-20T00:00:00Z" />)
    expect(screen.getByLabelText('Email risky (catch_all)')).toBeInTheDocument()
  })
})

describe('VerificationCard', () => {
  it('shows counts', () => {
    render(<VerificationCard summary={{ configured: true, pending: 3, risky: 2, invalid: 1, pausedReason: null }} />)
    expect(screen.getByText('Waiting for verification')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('explains when verification is not configured', () => {
    render(<VerificationCard summary={{ configured: false, pending: 0, risky: 0, invalid: 0, pausedReason: null }} />)
    expect(screen.getByText(/Verification not configured/)).toBeInTheDocument()
  })

  it('shows a paused reason as an alert', () => {
    render(<VerificationCard summary={{ configured: true, pending: 5, risky: 0, invalid: 0, pausedReason: 'out of MillionVerifier credits' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Verification paused: out of MillionVerifier credits')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/features/verification`
Expected: FAIL. The modules don't exist yet.

- [ ] **Step 3: Implement the summary and components**

`src/features/verification/types.ts`:

```ts
export interface VerificationSummaryDTO {
  configured: boolean
  pending: number
  risky: number
  invalid: number
  pausedReason: string | null
}
```

`src/features/verification/server/get-verification-summary.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import { isVerificationConfigured } from './get-verifier'
import type { VerificationSummaryDTO } from '../types'

/** Verification counts among leads enrolled in any sequence. */
export async function getVerificationSummary(organizationId: string): Promise<VerificationSummaryDTO> {
  const enrolled = { organizationId, sequenceEnrollments: { some: {} } }
  const [pending, risky, invalid, org] = await Promise.all([
    prisma.lead.count({ where: { ...enrolled, emailCheck: 'PENDING' } }),
    prisma.lead.count({ where: { ...enrolled, emailCheck: 'RISKY' } }),
    prisma.lead.count({ where: { ...enrolled, emailCheck: 'INVALID' } }),
    prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { verificationPausedReason: true } }),
  ])
  return { configured: isVerificationConfigured(), pending, risky, invalid, pausedReason: org.verificationPausedReason }
}
```

`src/features/verification/components/email-check-badge.tsx`:

```tsx
import type { EmailCheck } from '@prisma/client'
import { Badge } from '@/components/ui/badge'

const LABEL: Record<EmailCheck, string> = {
  UNCHECKED: 'Not checked',
  PENDING: 'Verifying',
  OK: 'Verified',
  RISKY: 'Risky',
  INVALID: 'Invalid',
}

const VARIANT: Record<EmailCheck, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
  UNCHECKED: 'muted',
  PENDING: 'default',
  OK: 'success',
  RISKY: 'warning',
  INVALID: 'danger',
}

interface Props {
  check: EmailCheck
  result: string | null
  checkedAt: Date | string | null
}

export function EmailCheckBadge({ check, result, checkedAt }: Props) {
  const date = checkedAt
    ? new Date(checkedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const title = result ? `Verification: ${result}${date ? ` · ${date}` : ''}` : undefined
  return (
    <span title={title}>
      <Badge variant={VARIANT[check]} showIcon aria-label={`Email ${LABEL[check].toLowerCase()}${result ? ` (${result})` : ''}`}>
        {LABEL[check]}
      </Badge>
    </span>
  )
}
```

`src/features/verification/components/verification-card.tsx`:

```tsx
import type { VerificationSummaryDTO } from '../types'

export function VerificationCard({ summary }: { summary: VerificationSummaryDTO }) {
  return (
    <section className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 shadow-[var(--shadow-card)] space-y-3">
      <h2 className="text-[var(--text-primary)] font-semibold text-sm">Email verification</h2>
      {!summary.configured ? (
        <p className="text-[var(--text-muted)] text-sm">
          Verification not configured. Add MILLIONVERIFIER_API_KEY to check addresses before the first email.
        </p>
      ) : (
        <>
          {summary.pausedReason && (
            <p role="alert" className="text-[var(--status-danger)] text-sm">
              Verification paused: {summary.pausedReason}. First emails wait until it resumes.
            </p>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {([
              ['Waiting for verification', summary.pending],
              ['Risky (catch-all / unknown)', summary.risky],
              ['Invalid (not emailed)', summary.invalid],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-btn)] border border-[var(--border-default)] p-3">
                <dt className="text-[var(--text-muted)] text-xs">{label}</dt>
                <dd className="text-[var(--text-primary)] text-lg font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Wire the badge into the leads UI**

- **`src/features/leads/types.ts`:** add `| 'emailCheck' | 'emailCheckResult' | 'emailCheckedAt'` to the `Pick<Lead, …>` of both `LeadDTO` and `LeadDetailDTO`.
- **`get-leads.ts` and `get-lead.ts`:** add `emailCheck: true, emailCheckResult: true, emailCheckedAt: true,` to the `select`.
- **`leads-table.tsx`:** inside the `<div className="flex flex-wrap items-center gap-1.5">` that holds `<StatusBadge …/>`, add:

```tsx
                    <EmailCheckBadge check={lead.emailCheck} result={lead.emailCheckResult} checkedAt={lead.emailCheckedAt} />
```

- **`lead-header.tsx`:** render the same badge next to the status `<Badge>` (after it, inside the same flex row), using `lead.emailCheck` / `lead.emailCheckResult` / `lead.emailCheckedAt`.

Fix every test fixture that builds a `LeadDTO`/`LeadDetailDTO` and now fails `tsc`. Add `emailCheck: 'UNCHECKED', emailCheckResult: null, emailCheckedAt: null`.

- [ ] **Step 5: Wire the card into Deliverability**

In `src/app/(dashboard)/deliverability/page.tsx`:
- Import `getVerificationSummary`.
- Replace `overview = await getDeliverabilityOverview(org.id)` with:

```ts
    ;[overview, verification] = await Promise.all([getDeliverabilityOverview(org.id), getVerificationSummary(org.id)])
```

- Declare `let verification` next to `let overview`.
- Pass `verification={verification}` to `<DeliverabilityClient …/>`.

In `deliverability-client.tsx`:
- Add `verification?: VerificationSummaryDTO` to its props.
- Import `VerificationCard`.
- Render `{verification && <VerificationCard summary={verification} />}` directly before the Domains `<section>`, which is the first section after the summary stat cards.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/features/verification src/features/leads src/features/deliverability && npx tsc --noEmit && npx eslint src/features/verification src/features/leads src/features/deliverability`
Expected: PASS, 0 lint errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/verification src/features/leads src/features/deliverability "src/app/(dashboard)/deliverability"
git commit -m "feat(verification): lead verification badge and Deliverability verification card"
```

---

### Task 9: Content checker (pure)

**Files:**
- Create: `src/features/content-check/check-content.ts`
- Test: `src/features/content-check/check-content.test.ts`

**Interfaces:**
- Produces:
  - `type Severity = 'LOW' | 'MEDIUM' | 'HIGH'`
  - `interface Finding { rule: string; severity: Severity; found: string; fix: string }`
  - `interface ContentResult { level: Severity; findings: Finding[] }`
  - `interface ContentInput { subject: string; body: string; isFirstStep: boolean; blockedPhrases: string[]; allowedWords?: string[] }`
  - `checkContent(input: ContentInput): ContentResult`
  - `levelOf(findings: Finding[]): Severity`
  - `TRIGGER_PHRASES: readonly string[]`

- [ ] **Step 1: Write the failing test**

`src/features/content-check/check-content.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkContent, levelOf } from './check-content'

const CLEAN_BODY =
  'Hi {firstName|there},\n\n{personalization}\n\nWe handle plowing, salting and sealcoating for commercial lots across Buffalo, and have kept properties like yours clear for over twenty years. Would a quick quote for next season be useful for {company}?\n\nThanks,\nJustin'
const base = { subject: 'Snow plan for {company}', body: CLEAN_BODY, isFirstStep: true, blockedPhrases: [] as string[] }
const rules = (o: Partial<typeof base> & { allowedWords?: string[] }) => checkContent({ ...base, ...o }).findings.map((f) => `${f.rule}:${f.severity}`)

describe('checkContent', () => {
  it('scores ordinary copy LOW with no findings', () => {
    expect(checkContent(base)).toEqual({ level: 'LOW', findings: [] })
  })

  it('flags a fake reply subject on the first step only', () => {
    expect(rules({ subject: 'Re: your parking lot' })).toContain('fake-reply:HIGH')
    expect(rules({ subject: 'FW: quote' })).toContain('fake-reply:HIGH')
    expect(rules({ subject: 'Re: your parking lot', isFirstStep: false })).not.toContain('fake-reply:HIGH')
  })

  it('flags link shorteners', () => {
    expect(rules({ body: `${CLEAN_BODY}\nhttps://bit.ly/abc` })).toContain('shortener:HIGH')
  })

  it('grades link counts: 1 ok, 2 MEDIUM, 3+ HIGH', () => {
    expect(rules({ body: `${CLEAN_BODY}\nhttps://acme.com` })).toEqual([])
    expect(rules({ body: `${CLEAN_BODY}\nhttps://acme.com www.acme.com/snow` })).toContain('two-links:MEDIUM')
    expect(rules({ body: `${CLEAN_BODY}\nhttps://a.com https://b.com https://c.com` })).toContain('too-many-links:HIGH')
  })

  it('flags guardrail terms and org phrases whole-word, honoring allowed words', () => {
    expect(rules({ body: `${CLEAN_BODY} Free estimate.` })).toContain('blocked-phrase:HIGH')
    expect(rules({ body: `${CLEAN_BODY} Only $500 per push.` })).toContain('blocked-phrase:HIGH')
    expect(rules({ body: `${CLEAN_BODY} We are carefree.` })).not.toContain('blocked-phrase:HIGH')
    expect(rules({ body: `${CLEAN_BODY} Free estimate.`, allowedWords: ['free'] })).not.toContain('blocked-phrase:HIGH')
    expect(rules({ body: `${CLEAN_BODY} Ask about our winter promo.`, blockedPhrases: ['winter promo'] })).toContain('blocked-phrase:HIGH')
  })

  it('flags HTML and images', () => {
    expect(rules({ body: `${CLEAN_BODY}<img src="x.png">` })).toContain('html:MEDIUM')
  })

  it('flags each trigger phrase once, case-insensitively', () => {
    const f = rules({ body: `${CLEAN_BODY} Act now, limited time! Click here.` })
    expect(f.filter((r) => r === 'trigger-phrase:MEDIUM')).toHaveLength(3)
  })

  it('flags shouting: 3+ all-caps words, !!, or emoji in the subject', () => {
    expect(rules({ body: `${CLEAN_BODY} BEST SNOW PLOWING TEAM` })).toContain('shouting:MEDIUM')
    expect(rules({ body: `${CLEAN_BODY} Call us HVAC LLC USA` })).not.toContain('shouting:MEDIUM') // 3-letter acronyms don't count
    expect(rules({ body: `${CLEAN_BODY} Thanks!!` })).toContain('shouting:MEDIUM')
    expect(rules({ subject: 'Snow plan ❄️' })).toContain('shouting:MEDIUM')
  })

  it('flags body length', () => {
    expect(rules({ body: 'Hi {firstName|there}, quick question about your lot?' })).toContain('short-body:LOW')
    expect(rules({ body: Array.from({ length: 205 }, () => 'word').join(' ') })).toContain('long-body:MEDIUM')
  })

  it('flags merge fields without a fallback, except always-filled ones, and unclosed braces', () => {
    expect(rules({ body: `${CLEAN_BODY} See you in {city}.` })).toContain('merge-field:MEDIUM')
    expect(rules({ body: `${CLEAN_BODY} See you in {city|your area}.` })).not.toContain('merge-field:MEDIUM')
    expect(rules({ body: `${CLEAN_BODY} Hi {firstName` })).toContain('merge-field:MEDIUM')
  })

  it('flags a long subject', () => {
    expect(rules({ subject: 'A very long subject line about commercial snow removal and salting' })).toContain('long-subject:LOW')
  })

  it('escalates three MEDIUM findings to HIGH', () => {
    expect(checkContent({ ...base, body: `${CLEAN_BODY} Act now. Limited time. Click here.` }).level).toBe('HIGH')
    expect(checkContent({ ...base, body: `${CLEAN_BODY} Act now.` }).level).toBe('MEDIUM')
  })

  it('levelOf returns the highest severity', () => {
    expect(levelOf([])).toBe('LOW')
    expect(levelOf([{ rule: 'x', severity: 'LOW', found: '', fix: '' }, { rule: 'y', severity: 'HIGH', found: '', fix: '' }])).toBe('HIGH')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/features/content-check/check-content.test.ts`
Expected: FAIL. The module doesn't exist yet.

- [ ] **Step 3: Implement**

`src/features/content-check/check-content.ts`:

```ts
// Template spam-risk heuristics for plain-text cold email. Pure — runs in the
// browser (live badges) and on the server (the auto-send gate). These catch
// common mistakes; they are not a model of any filter.

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface Finding {
  rule: string
  severity: Severity
  found: string
  fix: string
}

export interface ContentResult {
  level: Severity
  findings: Finding[]
}

export interface ContentInput {
  subject: string
  body: string
  isFirstStep: boolean
  blockedPhrases: string[]
  allowedWords?: string[]
}

export const TRIGGER_PHRASES = [
  'act now', 'limited time', 'risk-free', 'risk free', 'click here', '100%', 'no obligation', 'buy now',
  'order now', 'special promotion', 'exclusive deal', 'cash', 'winner', 'urgent', 'once in a lifetime',
  'double your', 'earn money', 'lowest price', 'best price',
] as const

const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly']
const LINK = /(?:https?:\/\/|www\.)[^\s<>"')]+/gi
const HTML = /<img\b|<a\s|<table\b|<div\b|<span\b|<font\b|style\s*=/i
const FAKE_REPLY = /^\s*(re|fwd|fw)\s*:/i
const TOKEN = /\{([a-zA-Z][a-zA-Z0-9_]*)(\|[^{}]*)?\}/g
const ALWAYS_FILLED = new Set(['firstName', 'company', 'personalization'])
const CAPS_WORD = /\b[A-Z]{4,}\b/g
const EMOJI = /\p{Extended_Pictographic}/u
const GUARDRAIL_WORDS = ['free', 'guarantee', 'guaranteed']
const CURRENCY = /\$\s?\d[\d,]*(?:\.\d+)?/

const RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive match not glued to other letters/digits ("free" ≠ "carefree"). */
function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

function wordCount(text: string): number {
  return text.replace(TOKEN, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

export function levelOf(findings: Finding[]): Severity {
  if (findings.length === 0) return 'LOW'
  if (findings.filter((f) => f.severity === 'MEDIUM').length >= 3) return 'HIGH'
  return findings.reduce<Severity>((max, f) => (RANK[f.severity] > RANK[max] ? f.severity : max), 'LOW')
}

export function checkContent(input: ContentInput): ContentResult {
  const { subject, body } = input
  const both = `${subject}\n${body}`
  const findings: Finding[] = []
  const add = (rule: string, severity: Severity, found: string, fix: string) => findings.push({ rule, severity, found, fix })

  if (input.isFirstStep && FAKE_REPLY.test(subject)) {
    add('fake-reply', 'HIGH', subject.trim(), 'Remove "Re:"/"Fwd:" — a first email pretending to be a reply is misleading and filtered.')
  }

  const links = body.match(LINK) ?? []
  const shortened = links.find((l) => SHORTENERS.some((s) => l.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').startsWith(`${s}/`)))
  if (shortened) add('shortener', 'HIGH', shortened, 'Use the full link to your own site; shortened links are a strong spam signal.')
  if (links.length >= 3) add('too-many-links', 'HIGH', `${links.length} links`, 'Keep cold emails to one link at most (the unsubscribe footer is added for you).')
  else if (links.length === 2) add('two-links', 'MEDIUM', '2 links', 'Cut to one link, or none — ask for a reply instead.')

  const allowed = new Set((input.allowedWords ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean))
  for (const word of GUARDRAIL_WORDS) {
    if (!allowed.has(word) && containsPhrase(both, word)) add('blocked-phrase', 'HIGH', word, `Remove "${word}" — it is blocked in drafts and a classic spam word.`)
  }
  const money = both.match(CURRENCY)
  if (money) add('blocked-phrase', 'HIGH', money[0], 'Leave prices out of the first emails; talk numbers once they reply.')
  for (const raw of input.blockedPhrases) {
    const phrase = raw.trim()
    if (phrase && containsPhrase(both, phrase)) add('blocked-phrase', 'HIGH', phrase, `"${phrase}" is on your blocked-phrase list (Settings).`)
  }

  if (HTML.test(body)) add('html', 'MEDIUM', 'HTML or image tags', 'Write plain text — images and HTML formatting hurt cold-email placement.')

  for (const phrase of TRIGGER_PHRASES) {
    if (containsPhrase(both, phrase)) add('trigger-phrase', 'MEDIUM', phrase, `Reword "${phrase}" — it reads like an ad.`)
  }

  const caps = both.replace(TOKEN, ' ').match(CAPS_WORD) ?? []
  const shout = caps.length >= 3 ? caps.slice(0, 3).join(' ') : both.includes('!!') ? '!!' : EMOJI.test(subject) ? 'emoji in subject' : null
  if (shout) add('shouting', 'MEDIUM', shout, 'Drop the all-caps words, repeated "!" and emoji — write like a normal email.')

  const words = wordCount(body)
  if (words > 200) add('long-body', 'MEDIUM', `${words} words`, 'Aim for 50–125 words; cold emails over 200 words get skimmed and filtered.')
  else if (words < 25) add('short-body', 'LOW', `${words} words`, 'Add a sentence of context — very short emails can look like spam probes.')

  const withoutTokens = both.replace(TOKEN, '')
  if (/[{}]/.test(withoutTokens)) add('merge-field', 'MEDIUM', 'unclosed { or }', 'Close every merge field, e.g. {city|your area}.')
  for (const m of both.matchAll(TOKEN)) {
    const [whole, field, fallback] = m
    if (!fallback && field && !ALWAYS_FILLED.has(field)) {
      add('merge-field', 'MEDIUM', whole, `Add a fallback, e.g. {${field}|…}, or the draft is blocked when ${field} is empty.`)
    }
  }

  if (subject.trim().length > 60) add('long-subject', 'LOW', `${subject.trim().length} characters`, 'Keep subjects under 60 characters so they aren\'t cut off.')

  return { level: levelOf(findings), findings }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/features/content-check/check-content.test.ts`
Expected: PASS. If a threshold case fails, fix the implementation, not the test; the thresholds are the spec's.

- [ ] **Step 5: Commit**

```bash
git add src/features/content-check
git commit -m "feat(content-check): pure template spam-risk checker"
```

---

### Task 10: Content gate on auto-send and live edits

**Files:**
- Create: `src/features/content-check/campaign-content.ts`
- Create: `src/features/content-check/types.ts`
- Create: `src/features/content-check/server/content-gate.ts`
- Test: `src/features/content-check/campaign-content.test.ts`
- Test: `src/features/content-check/server/content-gate.test.ts`
- Modify:
  - `src/features/campaigns/server/campaign-sending.ts`
  - `src/features/sequences/server/create-sequence.ts`
  - `src/features/sequences/server/update-sequence.ts`
  - `src/features/sequences/server/manage-subject-variants.ts`
- Modify routes (map `ContentHighRiskError` → 422):
  - `src/app/api/campaigns/[id]/route.ts`
  - `src/app/api/sequences/route.ts`
  - `src/app/api/sequences/[id]/route.ts`
  - `src/app/api/sequences/steps/[stepId]/variants/route.ts`
  - `src/app/api/sequences/variants/[variantId]/route.ts`

**Interfaces:**
- Consumes: `checkContent`, `levelOf`, `Severity`, `Finding` (Task 9).
- Produces:
  - `interface ContentItem { key: string; label: string; subject: string; body: string; isFirstStep: boolean }`
  - `interface ItemResult extends ContentItem { level: Severity; findings: Finding[] }`
  - `interface CampaignContentEvaluation { level: Severity; items: ItemResult[] }`
  - `stepItems(sequenceId: string, sequenceName: string, steps: { stepNumber: number; subject: string; body: string }[]): ContentItem[]`
  - `variantItem(sequenceId: string, sequenceName: string, variantId: string, subject: string, firstStepBody: string): ContentItem`
  - `evaluateItems(items: ContentItem[], blockedPhrases: string[], allowedWords: string[]): CampaignContentEvaluation`
  - `class ContentHighRiskError extends Error { items: ItemResult[] }`
  - `contentHash(items: ContentItem[]): string`
  - `loadCampaignContent(organizationId: string, campaignId: string): Promise<LoadedContent | null>`
  - `assertContentAllowed(input: { organizationId: string; campaignId: string; apply?: (items: ContentItem[]) => ContentItem[]; enablingAutoSend?: boolean }): Promise<void>`

- [ ] **Step 1: Write the failing pure test**

`src/features/content-check/campaign-content.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { stepItems, variantItem, evaluateItems } from './campaign-content'

const BODY = 'Hi {firstName|there},\n\n{personalization}\n\nWe handle plowing, salting and sealcoating for commercial lots across Buffalo. Would a quick quote for next season help?\n\nThanks'

describe('campaign content items', () => {
  it('keys steps by sequence and number; only step 1 is a first step', () => {
    const items = stepItems('seq-1', 'Fall outreach', [
      { stepNumber: 1, subject: 'Snow plan', body: BODY },
      { stepNumber: 2, subject: 'Re: Snow plan', body: BODY },
    ])
    expect(items.map((i) => [i.key, i.isFirstStep, i.label])).toEqual([
      ['step:seq-1:1', true, 'Fall outreach — step 1'],
      ['step:seq-1:2', false, 'Fall outreach — step 2'],
    ])
  })

  it('keys variants by sequence and variant, scored against the first step body', () => {
    expect(variantItem('seq-1', 'Fall outreach', 'v-1', 'Quick question', BODY)).toEqual({
      key: 'variant:seq-1:v-1', label: 'Fall outreach — subject variant "Quick question"', subject: 'Quick question', body: BODY, isFirstStep: true,
    })
  })

  it('evaluates to the worst item level', () => {
    const items = [...stepItems('s', 'S', [{ stepNumber: 1, subject: 'Snow plan', body: BODY }]), variantItem('s', 'S', 'v', 'Re: hi', BODY)]
    const res = evaluateItems(items, [], [])
    expect(res.level).toBe('HIGH')
    expect(res.items.find((i) => i.key === 'variant:s:v')!.level).toBe('HIGH')
    expect(res.items.find((i) => i.key === 'step:s:1')!.level).toBe('LOW')
  })

  it('an empty campaign is LOW', () => {
    expect(evaluateItems([], [], []).level).toBe('LOW')
  })
})
```

- [ ] **Step 2: Implement the pure module and the error types**

`src/features/content-check/campaign-content.ts`:

```ts
import { checkContent, type Finding, type Severity } from './check-content'

const RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

export interface ContentItem {
  key: string
  label: string
  subject: string
  body: string
  isFirstStep: boolean
}

export interface ItemResult extends ContentItem {
  level: Severity
  findings: Finding[]
}

export interface CampaignContentEvaluation {
  level: Severity
  items: ItemResult[]
}

export function stepItems(
  sequenceId: string,
  sequenceName: string,
  steps: { stepNumber: number; subject: string; body: string }[],
): ContentItem[] {
  return steps.map((s) => ({
    key: `step:${sequenceId}:${s.stepNumber}`,
    label: `${sequenceName} — step ${s.stepNumber}`,
    subject: s.subject,
    body: s.body,
    isFirstStep: s.stepNumber === 1,
  }))
}

export function variantItem(sequenceId: string, sequenceName: string, variantId: string, subject: string, firstStepBody: string): ContentItem {
  return {
    key: `variant:${sequenceId}:${variantId}`,
    label: `${sequenceName} — subject variant "${subject}"`,
    subject,
    body: firstStepBody,
    isFirstStep: true,
  }
}

export function evaluateItems(items: ContentItem[], blockedPhrases: string[], allowedWords: string[]): CampaignContentEvaluation {
  const results = items.map((item) => {
    const { level, findings } = checkContent({ subject: item.subject, body: item.body, isFirstStep: item.isFirstStep, blockedPhrases, allowedWords })
    return { ...item, level, findings }
  })
  const worst = results.reduce<Severity>((max, r) => (RANK[r.level] > RANK[max] ? r.level : max), 'LOW')
  return { level: worst, items: results }
}
```

`src/features/content-check/types.ts`:

```ts
import type { ItemResult } from './campaign-content'
import type { Severity } from './check-content'

export class ContentHighRiskError extends Error {
  constructor(public readonly items: ItemResult[]) {
    super(
      `High spam risk in ${items.map((i) => i.label).join(', ')}. Fix the flagged content, or record an override on the campaign page.`,
    )
    this.name = 'ContentHighRiskError'
    Object.setPrototypeOf(this, ContentHighRiskError.prototype)
  }
}

export class ContentOverrideValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentOverrideValidationError'
    Object.setPrototypeOf(this, ContentOverrideValidationError.prototype)
  }
}

export interface ContentStatusDTO {
  level: Severity
  items: ItemResult[]
  override: { reason: string; by: string | null; at: string; valid: boolean } | null
}
```

Run: `npx vitest run src/features/content-check/campaign-content.test.ts`
Expected: PASS.

- [ ] **Step 3: Write the failing gate test**

`src/features/content-check/server/content-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { campaign: { findFirst: vi.fn() } } }))

import { prisma } from '@/lib/db/prisma'
import { assertContentAllowed, contentHash, loadCampaignContent } from './content-gate'
import { ContentHighRiskError } from '../types'
import { stepItems } from '../campaign-content'

type Fn = ReturnType<typeof vi.fn>
const find = (prisma as unknown as { campaign: { findFirst: Fn } }).campaign.findFirst

const GOOD = 'Hi {firstName|there},\n\n{personalization}\n\nWe handle plowing, salting and sealcoating for commercial lots across Buffalo. Would a quick quote for next season help?\n\nThanks'
const campaign = (o: Record<string, unknown> = {}) => ({
  id: 'camp-1', autoSend: true, contentOverrideHash: null, contentOverrideReason: null, contentOverrideBy: null, contentOverrideAt: null,
  organization: { guardrailBlockedPhrases: [], guardrailAllowedWords: [] },
  sequences: [{
    id: 'seq-1', name: 'Fall',
    steps: [{ id: 'st-1', stepNumber: 1, subject: 'Snow plan', body: GOOD, subjectVariants: [{ id: 'v-1', subject: 'Quick question' }] }],
  }],
  ...o,
})

beforeEach(() => vi.resetAllMocks())

describe('loadCampaignContent', () => {
  it('loads steps and only non-archived variants (Review Focus #5)', async () => {
    find.mockResolvedValue(campaign())
    const loaded = await loadCampaignContent('org-1', 'camp-1')
    expect(find.mock.calls[0]![0]).toMatchObject({
      where: { id: 'camp-1', organizationId: 'org-1' },
      select: { sequences: { select: { steps: { select: { subjectVariants: { where: { isArchived: false } } } } } } },
    })
    expect(loaded!.items.map((i) => i.key)).toEqual(['step:seq-1:1', 'variant:seq-1:v-1'])
  })

  it('returns null for another org\'s campaign', async () => {
    find.mockResolvedValue(null)
    expect(await loadCampaignContent('org-1', 'nope')).toBeNull()
  })
})

describe('assertContentAllowed', () => {
  it('allows LOW content', async () => {
    find.mockResolvedValue(campaign())
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', enablingAutoSend: true })).resolves.toBeUndefined()
  })

  it('allows a campaign with no sequences (Review Focus #5)', async () => {
    find.mockResolvedValue(campaign({ sequences: [] }))
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', enablingAutoSend: true })).resolves.toBeUndefined()
  })

  it('refuses enabling auto-send while a step is HIGH', async () => {
    find.mockResolvedValue(campaign({ autoSend: false, sequences: [{ id: 'seq-1', name: 'Fall', steps: [{ id: 'st-1', stepNumber: 1, subject: 'Re: your lot', body: GOOD, subjectVariants: [] }] }] }))
    const err = await assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', enablingAutoSend: true }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ContentHighRiskError)
    expect((err as ContentHighRiskError).items.map((i) => i.key)).toEqual(['step:seq-1:1'])
  })

  it('does not gate edits to a campaign that is not auto-sending', async () => {
    find.mockResolvedValue(campaign({ autoSend: false }))
    const apply = (items: ReturnType<typeof stepItems>) => [...items, ...stepItems('new', 'New', [{ stepNumber: 1, subject: 'Re: hi', body: GOOD }])]
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', apply })).resolves.toBeUndefined()
  })

  it('refuses a HIGH edit on a live campaign, evaluating the edit applied', async () => {
    find.mockResolvedValue(campaign())
    const apply = (items: ReturnType<typeof stepItems>) => items.map((i) => (i.key === 'variant:seq-1:v-1' ? { ...i, subject: 'Re: hi' } : i))
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', apply })).rejects.toBeInstanceOf(ContentHighRiskError)
  })

  it('honors an override whose hash matches the content being saved, and rejects it after a further change', async () => {
    const high = campaign({ sequences: [{ id: 'seq-1', name: 'Fall', steps: [{ id: 'st-1', stepNumber: 1, subject: 'Re: your lot', body: GOOD, subjectVariants: [] }] }] })
    const items = (await (async () => { find.mockResolvedValueOnce(high); return (await loadCampaignContent('org-1', 'camp-1'))!.items })())
    find.mockResolvedValue({ ...high, contentOverrideHash: contentHash(items), contentOverrideReason: 'Existing customer thread' })
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', enablingAutoSend: true })).resolves.toBeUndefined()
    const apply = (xs: typeof items) => xs.map((i) => ({ ...i, subject: 'RE: your lot!!' }))
    await expect(assertContentAllowed({ organizationId: 'org-1', campaignId: 'camp-1', apply })).rejects.toBeInstanceOf(ContentHighRiskError)
  })

  it('contentHash is order-independent and content-sensitive', () => {
    const a = stepItems('s', 'S', [{ stepNumber: 1, subject: 'A', body: 'x' }, { stepNumber: 2, subject: 'B', body: 'y' }])
    expect(contentHash(a)).toBe(contentHash([...a].reverse()))
    expect(contentHash(a)).not.toBe(contentHash(a.map((i) => ({ ...i, body: `${i.body}!` }))))
    expect(contentHash(a)).toMatch(/^[0-9a-f]{64}$/)
  })
})
```

Run: `npx vitest run src/features/content-check/server/content-gate.test.ts`
Expected: FAIL. The module doesn't exist yet.

- [ ] **Step 4: Implement the gate**

First confirm the `SequenceStep` → `SubjectVariant` relation field name in `prisma/schema.prisma` (the one tagged `@relation("StepVariants")`). The code below assumes `subjectVariants`. Use the actual name, and make the test's fixture match.

`src/features/content-check/server/content-gate.ts`:

```ts
import { createHash } from 'node:crypto'
import { prisma } from '@/lib/db/prisma'
import { evaluateItems, stepItems, variantItem, type ContentItem } from '../campaign-content'
import { ContentHighRiskError } from '../types'

export interface LoadedContent {
  campaignId: string
  autoSend: boolean
  items: ContentItem[]
  blockedPhrases: string[]
  allowedWords: string[]
  override: { reason: string; by: string | null; at: Date; hash: string } | null
}

/** SHA-256 over the campaign's content in a stable (key-sorted) order. */
export function contentHash(items: ContentItem[]): string {
  const canonical = [...items]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((i) => [i.key, i.subject, i.body])
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}

export async function loadCampaignContent(organizationId: string, campaignId: string): Promise<LoadedContent | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: {
      id: true,
      autoSend: true,
      contentOverrideHash: true,
      contentOverrideReason: true,
      contentOverrideBy: true,
      contentOverrideAt: true,
      organization: { select: { guardrailBlockedPhrases: true, guardrailAllowedWords: true } },
      sequences: {
        select: {
          id: true,
          name: true,
          steps: {
            orderBy: { stepNumber: 'asc' },
            select: {
              id: true,
              stepNumber: true,
              subject: true,
              body: true,
              subjectVariants: { where: { isArchived: false }, select: { id: true, subject: true } },
            },
          },
        },
      },
    },
  })
  if (!campaign) return null

  const items: ContentItem[] = []
  for (const seq of campaign.sequences) {
    items.push(...stepItems(seq.id, seq.name, seq.steps))
    const first = seq.steps.find((s) => s.stepNumber === 1)
    if (first) for (const v of first.subjectVariants) items.push(variantItem(seq.id, seq.name, v.id, v.subject, first.body))
  }

  return {
    campaignId: campaign.id,
    autoSend: campaign.autoSend,
    items,
    blockedPhrases: campaign.organization.guardrailBlockedPhrases,
    allowedWords: campaign.organization.guardrailAllowedWords,
    override:
      campaign.contentOverrideHash && campaign.contentOverrideReason && campaign.contentOverrideAt
        ? { reason: campaign.contentOverrideReason, by: campaign.contentOverrideBy, at: campaign.contentOverrideAt, hash: campaign.contentOverrideHash }
        : null,
  }
}

/**
 * Refuse HIGH-risk content on a campaign that is (or is about to start)
 * auto-sending, unless a recorded override matches the exact content.
 * `apply` returns the content as it will be after the pending write.
 * A missing campaign is the caller's 404 to raise, not ours.
 */
export async function assertContentAllowed(input: {
  organizationId: string
  campaignId: string
  apply?: (items: ContentItem[]) => ContentItem[]
  enablingAutoSend?: boolean
}): Promise<void> {
  const loaded = await loadCampaignContent(input.organizationId, input.campaignId)
  if (!loaded) return
  if (!loaded.autoSend && !input.enablingAutoSend) return
  const items = input.apply ? input.apply(loaded.items) : loaded.items
  const evaluation = evaluateItems(items, loaded.blockedPhrases, loaded.allowedWords)
  if (evaluation.level !== 'HIGH') return
  if (loaded.override && loaded.override.hash === contentHash(items)) return
  throw new ContentHighRiskError(evaluation.items.filter((i) => i.level === 'HIGH'))
}
```

Run: `npx vitest run src/features/content-check`
Expected: PASS.

- [ ] **Step 5: Wire the gate into the write paths**

**`campaign-sending.ts` `updateCampaignSending`:** after the not-found check, add:

```ts
  if (input.autoSend === true) {
    await assertContentAllowed({ organizationId: input.organizationId, campaignId: campaign.id, enablingAutoSend: true })
  }
```

**`create-sequence.ts`:** after the campaign/steps validation and before `$transaction`, add:

```ts
  await assertContentAllowed({
    organizationId,
    campaignId,
    apply: (items) => [...items, ...stepItems('new', name, steps)],
  })
```

**`update-sequence.ts`:**
- Add `campaignId: true` to what the `findFirst` returns. Use `select` or keep the `include`; with `include`, `campaignId` is already present.
- Inside `if (newSteps && newSteps.length > 0 && !hasActiveEnrollments)`, before the transaction (restructure so the gate runs before `prisma.$transaction`), add:

```ts
  if (newSteps && newSteps.length > 0 && !hasActiveEnrollments) {
    await assertContentAllowed({
      organizationId,
      campaignId: sequence.campaignId,
      apply: (items) => [
        ...items.filter((i) => !i.key.startsWith(`step:${sequenceId}:`) && !i.key.startsWith(`variant:${sequenceId}:`)),
        ...stepItems(sequenceId, name ?? sequence.name, newSteps),
      ],
    })
  }
```

**`manage-subject-variants.ts`:**
- Change `resolveOrgStep`'s select to `{ id: true, stepNumber: true, body: true, sequence: { select: { id: true, name: true, organizationId: true, campaignId: true } } }`.
- In `createSubjectVariant`, after the first-step check:

```ts
  await assertContentAllowed({
    organizationId,
    campaignId: step.sequence.campaignId,
    apply: (items) => [...items, variantItem(step.sequence.id, step.sequence.name, 'new', subject, step.body)],
  })
```

- In `updateSubjectVariant`, before the `updateMany`:

```ts
  const existing = await prisma.subjectVariant.findFirst({
    where: { id: variantId, organizationId },
    select: { sequenceStep: { select: { sequence: { select: { id: true, campaignId: true } } } } },
  })
  if (!existing) throw new SubjectVariantNotFoundError(variantId)
  const seq = existing.sequenceStep.sequence
  await assertContentAllowed({
    organizationId,
    campaignId: seq.campaignId,
    apply: (items) => items.map((i) => (i.key === `variant:${seq.id}:${variantId}` ? { ...i, subject } : i)),
  })
```

Import `assertContentAllowed` from `@/features/content-check/server/content-gate`, and `stepItems` / `variantItem` from `@/features/content-check/campaign-content`, where used.

Existing tests for these server functions mock `prisma` without `campaign.findFirst`. Add `vi.mock('@/features/content-check/server/content-gate', () => ({ assertContentAllowed: vi.fn() }))` to each affected test file (`campaign-sending.test.ts`, `create-sequence`/`update-sequence`/`manage-subject-variants` tests if they exist), so they keep testing their own logic. Also add one test to `campaign-sending.test.ts`:

```ts
  it('checks content when auto-send is being turned on, not when turned off', async () => {
    // arrange the campaign lookup as the file's existing tests do
    await updateCampaignSending({ organizationId: 'org-1', campaignId: 'camp-1', autoSend: true })
    expect(assertContentAllowed).toHaveBeenCalledWith({ organizationId: 'org-1', campaignId: 'camp-1', enablingAutoSend: true })
    vi.mocked(assertContentAllowed).mockClear()
    await updateCampaignSending({ organizationId: 'org-1', campaignId: 'camp-1', autoSend: false })
    expect(assertContentAllowed).not.toHaveBeenCalled()
  })
```

- [ ] **Step 6: Map the error in the five routes**

In each route's `catch`, add a branch before the final `throw err` / 500:

```ts
    if (err instanceof ContentHighRiskError) {
      return NextResponse.json({ code: 'CONTENT_HIGH_RISK', error: err.message, findings: err.items }, { status: 422 })
    }
```

`src/app/api/sequences/route.ts` has no generic catch for other errors; add the branch inside its existing `catch` before `throw err`. Import `ContentHighRiskError` from `@/features/content-check/types`.

Add a route test for `PATCH /api/campaigns/[id]` only (the other four share the identical mapping). Create `src/app/api/campaigns/[id]/route.test.ts` if absent:

```ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(async () => ({ orgId: 'clerk-org' })) }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn(async () => ({ id: 'org-1' })) }))
vi.mock('@/features/campaigns/server/campaign-sending', async (orig) => ({
  ...(await orig<typeof import('@/features/campaigns/server/campaign-sending')>()),
  updateCampaignSending: vi.fn(),
}))

import { PATCH } from './route'
import { updateCampaignSending } from '@/features/campaigns/server/campaign-sending'
import { ContentHighRiskError } from '@/features/content-check/types'

describe('PATCH /api/campaigns/[id]', () => {
  it('returns 422 CONTENT_HIGH_RISK with findings', async () => {
    vi.mocked(updateCampaignSending).mockRejectedValue(new ContentHighRiskError([{ key: 'step:s:1', label: 'Fall — step 1', subject: 'Re: hi', body: '', isFirstStep: true, level: 'HIGH', findings: [] }]))
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ autoSend: true }) }), { params: Promise.resolve({ id: 'camp-1' }) })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('CONTENT_HIGH_RISK')
    expect(body.findings[0].key).toBe('step:s:1')
  })
})
```

- [ ] **Step 7: Run everything touched**

Run: `npx vitest run src/features/content-check src/features/campaigns src/features/sequences src/app/api/campaigns src/app/api/sequences && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/content-check src/features/campaigns src/features/sequences src/app/api/campaigns src/app/api/sequences
git commit -m "feat(content-check): gate auto-send and live edits on High content risk (422 CONTENT_HIGH_RISK)"
```

---

### Task 11: Override route and campaign content panel

**Files:**
- Modify: `src/features/content-check/server/content-gate.ts` (add `recordContentOverride`, `getCampaignContentStatus`)
- Modify: `src/features/content-check/server/content-gate.test.ts`
- Create: `src/app/api/campaigns/[id]/content-override/route.ts`
- Test: `src/app/api/campaigns/[id]/content-override/route.test.ts`
- Create: `src/features/content-check/components/content-risk.tsx`
- Create: `src/features/content-check/components/campaign-content-panel.tsx`
- Test: `src/features/content-check/components/campaign-content-panel.test.tsx`
- Modify: `src/app/(dashboard)/campaigns/[id]/page.tsx`
- Modify: `src/features/campaigns/components/campaign-sending-panel.tsx` (show the server's error message)

**Interfaces:**
- Consumes:
  - `loadCampaignContent`, `contentHash`, `evaluateItems` (Task 10)
  - `ContentOverrideValidationError`, `ContentStatusDTO` (Task 10)
- Produces:
  - `recordContentOverride(input: { organizationId: string; campaignId: string; clerkUserId: string; reason: string }): Promise<ContentStatusDTO | null>` (null = campaign not found)
  - `getCampaignContentStatus(organizationId: string, campaignId: string): Promise<ContentStatusDTO | null>`
  - `POST /api/campaigns/[id]/content-override` `{ reason }` → 200 `ContentStatusDTO` | 400 | 404
  - `<ContentRisk result={{ level, findings }} label? />`
  - `<CampaignContentPanel campaignId status />`

- [ ] **Step 1: Write the failing server tests**

Append to `content-gate.test.ts` (extend the prisma mock to `campaign: { findFirst: vi.fn(), update: vi.fn() }` and the `find` typing accordingly):

```ts
import { recordContentOverride, getCampaignContentStatus } from './content-gate'
import { ContentOverrideValidationError } from '../types'

describe('recordContentOverride', () => {
  const update = () => (prisma as unknown as { campaign: { update: Fn } }).campaign.update

  it.each(['short', '   ', 'x'.repeat(501)])('rejects reason %j', async (reason) => {
    find.mockResolvedValue(campaign())
    await expect(recordContentOverride({ organizationId: 'org-1', campaignId: 'camp-1', clerkUserId: 'user_1', reason })).rejects.toBeInstanceOf(ContentOverrideValidationError)
  })

  it('stores the trimmed reason, user, time and current content hash', async () => {
    find.mockResolvedValue(campaign())
    update().mockResolvedValue({})
    await recordContentOverride({ organizationId: 'org-1', campaignId: 'camp-1', clerkUserId: 'user_1', reason: '  Reviewed with legal; keep the wording.  ' })
    const data = update().mock.calls[0]![0].data
    expect(data).toMatchObject({ contentOverrideReason: 'Reviewed with legal; keep the wording.', contentOverrideBy: 'user_1', contentOverrideAt: expect.any(Date) })
    expect(data.contentOverrideHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('returns null for a missing campaign', async () => {
    find.mockResolvedValue(null)
    expect(await recordContentOverride({ organizationId: 'org-1', campaignId: 'x', clerkUserId: 'u', reason: 'long enough reason' })).toBeNull()
  })
})

describe('getCampaignContentStatus', () => {
  it('reports the level, items and whether the override still matches', async () => {
    find.mockResolvedValue(campaign({ contentOverrideHash: 'stale', contentOverrideReason: 'Old reason here', contentOverrideAt: new Date('2026-09-20T00:00:00Z'), contentOverrideBy: 'user_1' }))
    const status = await getCampaignContentStatus('org-1', 'camp-1')
    expect(status!.level).toBe('LOW')
    expect(status!.items).toHaveLength(2)
    expect(status!.override).toEqual({ reason: 'Old reason here', by: 'user_1', at: '2026-09-20T00:00:00.000Z', valid: false })
  })
})
```

Run: `npx vitest run src/features/content-check/server`
Expected: FAIL. The functions don't exist yet.

- [ ] **Step 2: Implement the server functions**

Append to `content-gate.ts` (add `ContentOverrideValidationError` and `type ContentStatusDTO` to the `../types` import):

```ts
export async function getCampaignContentStatus(organizationId: string, campaignId: string): Promise<ContentStatusDTO | null> {
  const loaded = await loadCampaignContent(organizationId, campaignId)
  if (!loaded) return null
  const evaluation = evaluateItems(loaded.items, loaded.blockedPhrases, loaded.allowedWords)
  return {
    level: evaluation.level,
    items: evaluation.items,
    override: loaded.override
      ? { reason: loaded.override.reason, by: loaded.override.by, at: loaded.override.at.toISOString(), valid: loaded.override.hash === contentHash(loaded.items) }
      : null,
  }
}

export async function recordContentOverride(input: {
  organizationId: string
  campaignId: string
  clerkUserId: string
  reason: string
}): Promise<ContentStatusDTO | null> {
  const reason = input.reason.trim()
  if (reason.length < 10 || reason.length > 500) {
    throw new ContentOverrideValidationError('Give a reason of 10–500 characters.')
  }
  const loaded = await loadCampaignContent(input.organizationId, input.campaignId)
  if (!loaded) return null
  await prisma.campaign.update({
    where: { id: loaded.campaignId },
    data: {
      contentOverrideReason: reason,
      contentOverrideBy: input.clerkUserId,
      contentOverrideAt: new Date(),
      contentOverrideHash: contentHash(loaded.items),
    },
  })
  return getCampaignContentStatus(input.organizationId, input.campaignId)
}
```

Update the test's `campaign.findFirst` mock so the `getCampaignContentStatus` call inside `recordContentOverride` also resolves: `mockResolvedValue` already covers repeated calls.

Run: `npx vitest run src/features/content-check/server`
Expected: PASS.

- [ ] **Step 3: Write the override route and its test**

`src/app/api/campaigns/[id]/content-override/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { recordContentOverride } from '@/features/content-check/server/content-gate'
import { ContentOverrideValidationError } from '@/features/content-check/types'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
  if (!body || typeof body.reason !== 'string') return NextResponse.json({ error: 'reason is required' }, { status: 400 })

  try {
    const org = await resolveOrganization(orgId)
    const status = await recordContentOverride({ organizationId: org.id, campaignId: id, clerkUserId: userId, reason: body.reason })
    if (!status) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    return NextResponse.json(status)
  } catch (err) {
    if (err instanceof ContentOverrideValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[POST /api/campaigns/[id]/content-override]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

`route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn(async () => ({ id: 'org-1' })) }))
vi.mock('@/features/content-check/server/content-gate', () => ({ recordContentOverride: vi.fn() }))

import { auth } from '@clerk/nextjs/server'
import { recordContentOverride } from '@/features/content-check/server/content-gate'
import { ContentOverrideValidationError } from '@/features/content-check/types'
import { POST } from './route'

const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'camp-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1' } as never)
})

describe('POST /api/campaigns/[id]/content-override', () => {
  it('403 without an org', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null, userId: null } as never)
    expect((await call({ reason: 'long enough reason' })).status).toBe(403)
  })

  it('400 without a reason, and on a validation error', async () => {
    expect((await call({})).status).toBe(400)
    vi.mocked(recordContentOverride).mockRejectedValue(new ContentOverrideValidationError('Give a reason of 10–500 characters.'))
    expect((await call({ reason: 'short' })).status).toBe(400)
  })

  it('404 for another org\'s campaign', async () => {
    vi.mocked(recordContentOverride).mockResolvedValue(null)
    expect((await call({ reason: 'long enough reason' })).status).toBe(404)
  })

  it('200 records the override org-scoped with the signed-in user', async () => {
    vi.mocked(recordContentOverride).mockResolvedValue({ level: 'HIGH', items: [], override: { reason: 'long enough reason', by: 'user_1', at: '2026-10-01T00:00:00.000Z', valid: true } })
    const res = await call({ reason: 'long enough reason' })
    expect(res.status).toBe(200)
    expect(recordContentOverride).toHaveBeenCalledWith({ organizationId: 'org-1', campaignId: 'camp-1', clerkUserId: 'user_1', reason: 'long enough reason' })
  })
})
```

Run: `npx vitest run "src/app/api/campaigns/[id]/content-override"`
Expected: PASS.

- [ ] **Step 4: Write the failing panel test**

`src/features/content-check/components/campaign-content-panel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { CampaignContentPanel } from './campaign-content-panel'
import type { ContentStatusDTO } from '../types'

const high: ContentStatusDTO = {
  level: 'HIGH',
  items: [{ key: 'step:s:1', label: 'Fall — step 1', subject: 'Re: your lot', body: '', isFirstStep: true, level: 'HIGH', findings: [{ rule: 'fake-reply', severity: 'HIGH', found: 'Re: your lot', fix: 'Remove "Re:"/"Fwd:"' }] }],
  override: null,
}
const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
})

describe('CampaignContentPanel', () => {
  it('shows the worst level, the offending step and its fix', () => {
    render(<CampaignContentPanel campaignId="camp-1" status={high} />)
    expect(screen.getByText('High risk')).toBeInTheDocument()
    expect(screen.getByText('Fall — step 1')).toBeInTheDocument()
    expect(screen.getByText(/Remove "Re:"/)).toBeInTheDocument()
  })

  it('records an override with a reason', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...high, override: { reason: 'Reviewed and approved', by: 'user_1', at: '2026-10-01T00:00:00Z', valid: true } }), { status: 200 }))
    render(<CampaignContentPanel campaignId="camp-1" status={high} />)
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'Reviewed and approved' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record override' }))
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(fetchMock).toHaveBeenCalledWith('/api/campaigns/camp-1/content-override', expect.objectContaining({ method: 'POST', body: JSON.stringify({ reason: 'Reviewed and approved' }) }))
  })

  it('shows a server error in an alert', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Give a reason of 10–500 characters.' }), { status: 400 }))
    render(<CampaignContentPanel campaignId="camp-1" status={high} />)
    fireEvent.change(screen.getByLabelText('Override reason'), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record override' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Give a reason of 10–500 characters.')
  })

  it('shows a valid override instead of the form', () => {
    render(<CampaignContentPanel campaignId="camp-1" status={{ ...high, override: { reason: 'Reviewed and approved', by: 'user_1', at: '2026-10-01T00:00:00Z', valid: true } }} />)
    expect(screen.getByText(/Override in effect/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Override reason')).not.toBeInTheDocument()
  })

  it('hides the override form when nothing is High', () => {
    render(<CampaignContentPanel campaignId="camp-1" status={{ level: 'LOW', items: [], override: null }} />)
    expect(screen.getByText('Low risk')).toBeInTheDocument()
    expect(screen.queryByLabelText('Override reason')).not.toBeInTheDocument()
  })
})
```

Run: `npx vitest run src/features/content-check/components`
Expected: FAIL. The components don't exist yet.

- [ ] **Step 5: Implement the components**

`src/features/content-check/components/content-risk.tsx`:

```tsx
import { Badge } from '@/components/ui/badge'
import type { Finding, Severity } from '../check-content'

const VARIANT: Record<Severity, 'success' | 'warning' | 'danger'> = { LOW: 'success', MEDIUM: 'warning', HIGH: 'danger' }
const LABEL: Record<Severity, string> = { LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk' }

export function ContentRiskBadge({ level }: { level: Severity }) {
  return <Badge variant={VARIANT[level]} showIcon>{LABEL[level]}</Badge>
}

/** Level badge plus an expandable list of findings with fixes. */
export function ContentRisk({ level, findings, label }: { level: Severity; findings: Finding[]; label?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {label && <span className="text-[var(--text-secondary)] text-sm">{label}</span>}
        <ContentRiskBadge level={level} />
      </div>
      {findings.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--text-muted)]">
            {findings.length} {findings.length === 1 ? 'issue' : 'issues'}
          </summary>
          <ul className="mt-1 space-y-1">
            {findings.map((f, i) => (
              <li key={`${f.rule}-${i}`} className="text-[var(--text-secondary)]">
                <span className="font-medium">{f.severity.toLowerCase()}:</span> {f.found} — {f.fix}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
```

`src/features/content-check/components/campaign-content-panel.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ContentRisk, ContentRiskBadge } from './content-risk'
import type { ContentStatusDTO } from '../types'

export function CampaignContentPanel({ campaignId, status }: { campaignId: string; status: ContentStatusDTO }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const flagged = status.items.filter((i) => i.level !== 'LOW')
  const overrideValid = status.override?.valid ?? false

  async function recordOverride() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/content-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError(data?.error ?? 'Could not record the override.')
        return
      }
      setReason('')
      router.refresh()
    } catch {
      setError('Could not record the override.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[var(--text-primary)] font-semibold text-sm">Content check</h2>
        <ContentRiskBadge level={status.level} />
      </div>

      {flagged.length === 0 ? (
        <p className="text-[var(--text-muted)] text-xs">No spam-risk issues found in this campaign&apos;s emails.</p>
      ) : (
        <ul className="space-y-2">
          {flagged.map((item) => (
            <li key={item.key}>
              <ContentRisk level={item.level} findings={item.findings} label={item.label} />
            </li>
          ))}
        </ul>
      )}

      {status.override?.valid && (
        <p className="text-[var(--text-secondary)] text-xs">
          Override in effect since {new Date(status.override.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}: {status.override.reason}
        </p>
      )}

      {status.level === 'HIGH' && !overrideValid && (
        <div className="space-y-2">
          <p className="text-[var(--text-secondary)] text-xs">
            Automatic sending is blocked while any email is High risk. Fix the issues above, or record why this wording is intended.
          </p>
          <label className="block text-xs text-[var(--text-secondary)]" htmlFor={`override-${campaignId}`}>
            Override reason
          </label>
          <textarea
            id={`override-${campaignId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm"
          />
          <Button onClick={() => void recordOverride()} disabled={busy || reason.trim().length === 0}>
            Record override
          </Button>
        </div>
      )}

      {error && <p role="alert" className="text-[var(--status-danger)] text-sm">{error}</p>}
    </section>
  )
}
```

- [ ] **Step 6: Put the panel on the campaign page, and surface 422 messages in the sending panel**

In `src/app/(dashboard)/campaigns/[id]/page.tsx`:
- Import `getCampaignContentStatus` and `CampaignContentPanel`.
- Load `const contentStatus = await getCampaignContentStatus(org.id, <campaign id>)` beside the existing `getCampaignDetail` call. Use the page's existing variable names for the org and the campaign id.
- Render `{contentStatus && <CampaignContentPanel campaignId={<campaign id>} status={contentStatus} />}` directly below `<CampaignSendingPanel …/>`.

In `campaign-sending-panel.tsx` `toggleAutoSend`, replace:

```ts
      if (!res.ok) {
        setError('Could not update auto-send.')
        return
      }
```

with:

```ts
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? 'Could not update auto-send.')
        return
      }
```

Add a test to `campaign-sending-panel.test.tsx`: when the PATCH returns 422 `{ error: 'High spam risk in Fall — step 1. …' }`, the alert shows that text. Mirror the file's existing toggle test.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run src/features/content-check src/features/campaigns "src/app/api/campaigns" && npx tsc --noEmit && npx eslint src/features/content-check src/features/campaigns`
Expected: PASS, 0 lint errors.

- [ ] **Step 8: Commit**

```bash
git add src/features/content-check src/features/campaigns "src/app/api/campaigns" "src/app/(dashboard)/campaigns"
git commit -m "feat(content-check): campaign content panel and recorded override"
```

---

### Task 12: Live risk badges in the sequence editor

**Files:**
- Modify: `src/features/sequences/components/create-sequence-form.tsx`
- Test: `src/features/sequences/components/create-sequence-form.test.tsx` (create if absent)
- Modify: the page(s) that render `<CreateSequenceForm …/>` (find them with `grep -rn "CreateSequenceForm" src/app`)

**Interfaces:**
- Consumes: `checkContent` (Task 9), `ContentRisk` (Task 11).
- Produces: `CreateSequenceForm` gains optional props `blockedPhrases?: string[]` and `allowedWords?: string[]` (default `[]`).

- [ ] **Step 1: Write the failing test**

`src/features/sequences/components/create-sequence-form.test.tsx`: read the component's props first. The minimum is whatever it needs to render, e.g. `campaignId`. Then:

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import { CreateSequenceForm } from './create-sequence-form'

describe('CreateSequenceForm — live content risk', () => {
  it('scores each step as you type', () => {
    render(<CreateSequenceForm campaignId="camp-1" />)
    const subject = screen.getAllByPlaceholderText(/subject/i)[0]!
    const body = screen.getAllByPlaceholderText('Email body')[0]!
    fireEvent.change(body, { target: { value: 'Hi {firstName|there}, we plow and salt commercial lots across Buffalo every winter. Would a quote for next season be useful for your properties this year?' } })
    fireEvent.change(subject, { target: { value: 'Snow plan' } })
    expect(screen.getByText('Low risk')).toBeInTheDocument()
    fireEvent.change(subject, { target: { value: 'Re: snow plan' } })
    expect(screen.getByText('High risk')).toBeInTheDocument()
  })

  it('uses the org blocked phrases', () => {
    render(<CreateSequenceForm campaignId="camp-1" blockedPhrases={['winter promo']} />)
    fireEvent.change(screen.getAllByPlaceholderText('Email body')[0]!, { target: { value: 'Ask about our winter promo for commercial lots, plowing and salting across Buffalo this season.' } })
    expect(screen.getByText('High risk')).toBeInTheDocument()
  })

  it('shows a 422 CONTENT_HIGH_RISK message from the server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 'CONTENT_HIGH_RISK', error: 'High spam risk in New — step 1.' }), { status: 422 })))
    render(<CreateSequenceForm campaignId="camp-1" />)
    // fill the required fields the form validates (name, subject, body), then submit — follow the form's own labels
    fireEvent.change(screen.getByPlaceholderText(/sequence name/i), { target: { value: 'New' } })
    fireEvent.change(screen.getAllByPlaceholderText(/subject/i)[0]!, { target: { value: 'Re: hi' } })
    fireEvent.change(screen.getAllByPlaceholderText('Email body')[0]!, { target: { value: 'Hello there' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))
    expect(await screen.findByText('High spam risk in New — step 1.')).toBeInTheDocument()
  })
})
```

Adjust placeholders and button names to the form's actual text (read `create-sequence-form.tsx` lines 100–162). Keep what's asserted.

Run: `npx vitest run src/features/sequences/components`
Expected: FAIL.

- [ ] **Step 2: Implement**

In `create-sequence-form.tsx`:
- Add `blockedPhrases?: string[]` and `allowedWords?: string[]` to the props, defaulting both to `[]`.
- Import `checkContent` and `ContentRisk`.
- Directly under each step's body `<textarea>`, render:

```tsx
            {(() => {
              const risk = checkContent({ subject: step.subject, body: step.body, isFirstStep: i === 0, blockedPhrases, allowedWords })
              return <ContentRisk level={risk.level} findings={risk.findings} />
            })()}
```

Only show it once the step has some text: wrap it in `{(step.subject || step.body) && …}`.

Make the submit handler show the server's `error` field on a non-OK response, if it doesn't already:

```ts
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      setError(data?.error ?? '<the form's existing fallback message>')
```

Then pass the org lists where the form is rendered:
- Find the page(s) with `grep -rn "CreateSequenceForm" src/app`.
- Load `guardrailBlockedPhrases` and `guardrailAllowedWords` for the org. Use `getSendingSettings(org.id)` from `@/features/settings/server/sending-settings`, or reuse an org record the page already has.
- Pass them as `blockedPhrases` / `allowedWords`.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/features/sequences && npx tsc --noEmit && npx eslint src/features/sequences`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/sequences/components "src/app/(dashboard)"
git commit -m "feat(content-check): live spam-risk badges in the sequence editor"
```

---

### Task 13: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add two subsections to the existing `## Deliverability` section (after "### Alerts")**

`### Email verification` covers:
- MillionVerifier checks each lead's address when it's enrolled.
- Set `MILLIONVERIFIER_API_KEY` in Vercel (Production, and Preview if wanted). Without it, verification is off and sending works as before.
- Imports cost nothing.
- Results:
  - Verified → sends.
  - Risky (catch-all/unknown) → sends unless **Block risky emails** is on in Settings.
  - Invalid/disposable → the enrollment stops.
  - Real bounces also mark an address Invalid.
- The first email waits for a result: checks run every 5 minutes inside the sequence runner, and results are reused for 90 days.
- If credits run out or the key is rejected, first emails wait. You get one alert email, and the Deliverability page shows "Verification paused".
- Manual **Send** of a first email returns "being verified" until the check completes.

`### Content check` covers:
- Every step and subject variant gets a Low / Medium / High score, shown live in the sequence editor and on the campaign page.
- List the High rules in one line each:
  - fake `Re:`/`Fwd:` on the first email
  - link shorteners
  - 3+ links
  - blocked words / prices
- Auto-send can't be turned on (and live campaigns can't be edited to High) until the content is fixed or someone records an override reason on the campaign page.
- An override stops applying when the content changes.
- The AI personalization line is still covered by the per-email guardrails.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: email verification and content check"
```

---

## Self-review notes (for the executor)

**Spec coverage**

| Spec section | Task(s) |
|---|---|
| Data model (enum, Lead, Organization, Campaign fields) | 1 |
| Provider interface + MillionVerifier adapter | 2 |
| Result mapping, freshness, gate table | 3 |
| Worker (budget, concurrency, retries, account stop, alert claim) | 4 |
| PENDING on enrollment | 5 |
| Step-1 gate (wait → +10 min, stop) | 5 |
| Manual Send gate (422 EMAIL_NOT_VERIFIED) | 6 |
| Bounce feedback → INVALID | 5 |
| `blockRiskyEmails` setting | 7 |
| Lead badge, Deliverability verification card | 8 |
| `checkContent` rules and level | 9 |
| Campaign evaluation, gate on auto-send / live edits, 422 CONTENT_HIGH_RISK | 10 |
| Override (route, hash validity) + campaign page | 11 |
| Live badges in the sequence editor | 12 |
| Error-handling table | 4 (outage, worker throw), 5, 6, 10 (empty campaign, hash mismatch) |
| Docs | 13 |

**Interfaces that cross tasks, and must match**

- `verificationGate(lead, org, hasVerifier, now?)` → `{ action }`
- `isFreshResult(lead, now?)`
- `isVerificationConfigured(env?)`
- `verifyPendingLeads(budgetMs?, deps?)`
- `VERIFY_BUDGET_MS`
- `EmailNotVerifiedError(state, message)`
- `checkContent(input)` / `levelOf(findings)`
- `ContentItem` keys: `step:<sequenceId>:<n>`, `variant:<sequenceId>:<variantId>`
- `assertContentAllowed({ organizationId, campaignId, apply?, enablingAutoSend? })`
- `contentHash(items)`
- `ContentHighRiskError(items)`
- `ContentStatusDTO`
- `getCampaignContentStatus` / `recordContentOverride`
