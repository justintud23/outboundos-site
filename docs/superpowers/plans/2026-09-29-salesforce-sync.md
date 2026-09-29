# Salesforce Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect one Salesforce org per OutboundOS organization. Once connected, the app can:
- import Lead and Contact list views
- log sends and replies as Salesforce Tasks, creating a Salesforce Lead when an unknown prospect replies
- block sends to people Salesforce marks as opted out, customer, open-opportunity or converted

**Architecture:**
- **Connection:** an org-wide OAuth (PKCE) connection stores an encrypted refresh token.
- **One client:** `src/features/salesforce/server/client.ts` is the only code that talks to Salesforce. It handles token refresh, error mapping and API-usage limits.
- **Pre-send check:** a pure classifier feeds a cached check (`ensureSalesforceClear`), called from the sequence runner, the send queue and manual send.
- **Activity logging:** goes through a durable `salesforce_sync_jobs` queue, processed by the existing sequence-runner cron.

**Tech Stack:** Next.js 16.2 App Router, TypeScript strict (`noUncheckedIndexedAccess`), Prisma 7 + Neon Postgres, Vitest + Testing Library, Clerk v7, Node `crypto`, and global `fetch`. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-29-salesforce-sync-design.md`

## Global Constraints

- **Official APIs only:** OAuth 2.0 web-server flow with PKCE (S256), and the REST API version `v62.0`. No scraping, and no stored passwords.
- **No new npm dependencies.** Use Node `crypto` and global `fetch`.
- **New env vars:** `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (32 bytes, base64). If the Salesforce vars are missing, the Settings card shows "Salesforce isn't configured on this server" and nothing else changes.
- **When an org has no Salesforce connection, behavior is identical to today.** Every new hook is a no-op without a connection.
- **Sending never waits on Salesforce**, except the pre-send hold rule. A Salesforce failure never causes an email to a blocked person.
- **Access:**
  - Admin-only: connect, callback, disconnect, settings PATCH, job retry, the lead block override, and the `useSalesforceOwners` import option.
  - Any member: list views, preview and import.
- **Existing helpers:**
  - `resolveMember()` from `@/lib/auth/resolve-member` returns `{ org, member, isAdmin } | null`.
  - `denyUnlessAdmin(ctx)` from `@/lib/auth/permission-response` returns a 403 `{code:'ADMIN_ONLY'}` or null.
  - `sendOrgAlert(orgId, subject, text)` comes from `@/features/replies/server/notify`.
  - `prisma` comes from `@/lib/db/prisma`.
- **All SOQL values** go through `soqlString()` (Task 4). Email `IN` lists are chunked at 200.
- **User-facing copy:** plain words, no em dashes in UI strings.
- **Commits:** every commit ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit on `feat/salesforce-sync`. Never push.
- **Verification before each commit:**
  - `npx tsc --noEmit`
  - `npx eslint <touched paths>`
  - focused `npx vitest run <paths>`
- **Never print `.env` values.**

## Review Focus

1. **Salesforce is unreachable at send time and the lead's last check is more than 7 days old (or missing).** The send is held, not sent and not cancelled. Pinned in Task 6 (`ensureSalesforceClear` tests) and Task 7 (send-queue defers).
2. **One email matches a clear Contact and also a converted Lead.** The most restrictive result wins, so the send is blocked. Pinned in Task 5 (`mostRestrictive` test).
3. **The email contains an apostrophe (`o'brien@acme.com`) or a backslash.** The SOQL is escaped, not broken or injectable. Pinned in Task 4 (`soqlString`) and Task 5 (lookup query text).
4. **The same list view is imported twice.** No duplicate leads. The second run reports them as `linked`, with 0 imported. Pinned in Task 8.
5. **The access token expires mid-run (401).** The client refreshes once and retries. A second 401 marks the connection `NEEDS_RECONNECT`. Pinned in Task 4.
6. **Two replies from an unknown prospect arrive before the job runs.** Only one Salesforce Lead is created: the processor re-reads the link and searches before creating. Pinned in Task 10.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260930000000_salesforce_sync/migration.sql` (generated)

**Interfaces:**
- Produces:
  - Prisma models `SalesforceConnection` and `SalesforceSyncJob`
  - enums `SalesforceConnectionStatus`, `SalesforceObject`, `SfCheckStatus`, `SalesforceJobType`, `SalesforceJobStatus`
  - Lead fields `salesforceId`, `salesforceType`, `salesforceAccountId`, `sfCheckStatus`, `sfCheckedAt`, `sfCheckDetail`, `sfBlockOverride`, `sfHeldSince`
  - `Organization.lastSalesforceOrgId`

Two additions beyond the spec:
- `heldAlertedAt` on the connection, which de-duplicates the daily held alert.
- `Organization.lastSalesforceOrgId`, which detects a reconnect to a different Salesforce org even after a disconnect deleted the connection row.

- [ ] **Step 1: Add the enums** next to the other enums in `prisma/schema.prisma`:

```prisma
enum SalesforceConnectionStatus {
  CONNECTED
  NEEDS_RECONNECT
  RATE_LIMITED
}

enum SalesforceObject {
  LEAD
  CONTACT
}

enum SfCheckStatus {
  CLEAR
  CUSTOMER
  OPEN_OPPORTUNITY
  OPTED_OUT
  CONVERTED
  NOT_FOUND
}

enum SalesforceJobType {
  LOG_SEND
  LOG_REPLY
  CREATE_LEAD
}

enum SalesforceJobStatus {
  PENDING
  DONE
  FAILED
}
```

- [ ] **Step 2: Add the models:**

```prisma
model SalesforceConnection {
  id                     String                     @id @default(cuid())
  organizationId         String                     @unique
  organization           Organization               @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  instanceUrl            String
  loginHost              String
  sfOrgId                String
  sfUserId               String
  sfUsername             String
  sfUserEmail            String?
  refreshTokenEnc        String
  status                 SalesforceConnectionStatus @default(CONNECTED)
  lastError              String?
  rateLimitedUntil       DateTime?
  heldAlertedAt          DateTime?
  customerAccountTypes   String[]                   @default(["Customer"])
  blockOpenOpportunities Boolean                    @default(true)
  logActivity            Boolean                    @default(true)
  connectedAt            DateTime                   @default(now())
  connectedByMemberId    String?
  connectedBy            OrgMember?                 @relation("SalesforceConnectedBy", fields: [connectedByMemberId], references: [id], onDelete: SetNull)
  updatedAt              DateTime                   @updatedAt

  @@map("salesforce_connections")
}

model SalesforceSyncJob {
  id                String              @id @default(cuid())
  organizationId    String
  organization      Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  leadId            String
  lead              Lead                @relation(fields: [leadId], references: [id], onDelete: Cascade)
  type              SalesforceJobType
  outboundMessageId String?
  outboundMessage   OutboundMessage?    @relation(fields: [outboundMessageId], references: [id], onDelete: Cascade)
  inboundReplyId    String?
  inboundReply      InboundReply?       @relation(fields: [inboundReplyId], references: [id], onDelete: Cascade)
  status            SalesforceJobStatus @default(PENDING)
  attempts          Int                 @default(0)
  nextAttemptAt     DateTime            @default(now())
  lastError         String?
  sfTaskId          String?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt

  @@unique([type, outboundMessageId])
  @@unique([type, inboundReplyId])
  @@index([status, nextAttemptAt])
  @@index([organizationId, status])
  @@map("salesforce_sync_jobs")
}
```

- [ ] **Step 3: Add fields and back-relations:**
  - **`Organization`:** `lastSalesforceOrgId String?`, `salesforceConnection SalesforceConnection?`, `salesforceSyncJobs SalesforceSyncJob[]`.
  - **`OrgMember`:** `salesforceConnections SalesforceConnection[] @relation("SalesforceConnectedBy")`.
  - **`Lead`:** the fields below, plus `salesforceSyncJobs SalesforceSyncJob[]` and `@@index([organizationId, salesforceId])`:

```prisma
  salesforceId        String?
  salesforceType      SalesforceObject?
  salesforceAccountId String?
  sfCheckStatus       SfCheckStatus?
  sfCheckedAt         DateTime?
  sfCheckDetail       String?
  sfBlockOverride     Boolean          @default(false)
  sfHeldSince         DateTime?
```

  - **`OutboundMessage`:** `salesforceSyncJobs SalesforceSyncJob[]`.
  - **`InboundReply`:** `salesforceSyncJobs SalesforceSyncJob[]`.

- [ ] **Step 4: Generate the migration** (this uses the dev DB from `.env`):

Run: `npx prisma migrate dev --create-only --name salesforce_sync`

Then rename the created folder to `prisma/migrations/20260930000000_salesforce_sync`. Read the SQL and confirm it is additive only: CREATE TYPE / CREATE TABLE / ADD COLUMN / CREATE INDEX / ADD CONSTRAINT, and no DROP.

- [ ] **Step 5: Apply the migration and generate the client**

Run: `npx prisma migrate dev`
Expected: "Already in sync" or the migration applied, and the client generated.

Run: `npx prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --script --shadow-database-url "$SHADOW_DATABASE_URL"` if a shadow DB is configured; otherwise run `npx prisma migrate status`.
Expected: an empty diff, or "Database schema is up to date".

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npx vitest run src/features/leads`
Expected: PASS.

```bash
git add prisma/schema.prisma prisma/migrations/20260930000000_salesforce_sync
git commit -m "feat(salesforce): schema for connection, sync jobs and lead links"
```

---

### Task 2: Token cipher and app config

**Files:**
- Create: `src/lib/crypto/token-cipher.ts`, `src/lib/crypto/token-cipher.test.ts`
- Create: `src/features/salesforce/config.ts`, `src/features/salesforce/config.test.ts`
- Modify: `.env.example` if present (add the three vars with empty values and a one-line comment each). If `.env.example` doesn't exist, skip.

**Interfaces:**
- Produces:
  - `encryptToken(plain: string): string`
  - `decryptToken(enc: string): string` (throws on tamper or wrong key)
  - `SF_API_VERSION = 'v62.0'`
  - `type SfEnv = 'production' | 'sandbox'`
  - `getSalesforceAppConfig(): { clientId: string; clientSecret: string } | null`
  - `loginHostFor(env: SfEnv): string`
  - `salesforceCallbackUrl(): string`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/crypto/token-cipher.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptToken, decryptToken } from './token-cipher'

const KEY = randomBytes(32).toString('base64')
let saved: string | undefined
beforeEach(() => { saved = process.env.TOKEN_ENCRYPTION_KEY; process.env.TOKEN_ENCRYPTION_KEY = KEY })
afterEach(() => { process.env.TOKEN_ENCRYPTION_KEY = saved })

describe('token cipher', () => {
  it('round-trips and uses the v1 format', () => {
    const enc = encryptToken('refresh-abc')
    expect(enc.startsWith('v1:')).toBe(true)
    expect(enc.split(':')).toHaveLength(4)
    expect(decryptToken(enc)).toBe('refresh-abc')
  })
  it('is non-deterministic', () => {
    expect(encryptToken('x')).not.toBe(encryptToken('x'))
  })
  it('rejects a tampered ciphertext', () => {
    const [v, iv, tag, ct] = encryptToken('refresh-abc').split(':') as [string, string, string, string]
    const flipped = Buffer.from(ct, 'base64'); flipped[0] = (flipped[0] ?? 0) ^ 1
    expect(() => decryptToken([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
  })
  it('rejects a different key', () => {
    const enc = encryptToken('refresh-abc')
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    expect(() => decryptToken(enc)).toThrow()
  })
  it('throws a clear error when the key is missing or the wrong length', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY
    expect(() => encryptToken('x')).toThrow('TOKEN_ENCRYPTION_KEY is not set')
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64')
    expect(() => encryptToken('x')).toThrow('32 bytes')
  })
})
```

```ts
// src/features/salesforce/config.test.ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { getSalesforceAppConfig, loginHostFor, salesforceCallbackUrl } from './config'

afterEach(() => vi.unstubAllEnvs())

describe('salesforce config', () => {
  it('is null unless both client id and secret are set', () => {
    vi.stubEnv('SALESFORCE_CLIENT_ID', 'id'); vi.stubEnv('SALESFORCE_CLIENT_SECRET', '')
    expect(getSalesforceAppConfig()).toBeNull()
    vi.stubEnv('SALESFORCE_CLIENT_SECRET', 'secret')
    expect(getSalesforceAppConfig()).toEqual({ clientId: 'id', clientSecret: 'secret' })
  })
  it('maps environments to login hosts', () => {
    expect(loginHostFor('production')).toBe('https://login.salesforce.com')
    expect(loginHostFor('sandbox')).toBe('https://test.salesforce.com')
  })
  it('builds the callback url from NEXT_PUBLIC_APP_URL without a double slash', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example.com/')
    expect(salesforceCallbackUrl()).toBe('https://app.example.com/api/integrations/salesforce/callback')
  })
})
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run src/lib/crypto src/features/salesforce/config.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

```ts
// src/lib/crypto/token-cipher.ts
import crypto from 'node:crypto'

// Encrypts third-party refresh tokens at rest. Format: v1:<iv>:<tag>:<ciphertext> (base64).
const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  return key
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptToken(enc: string): string {
  const [version, iv, tag, ct] = enc.split(':')
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognized token format')
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}
```

```ts
// src/features/salesforce/config.ts
export const SF_API_VERSION = 'v62.0'
export type SfEnv = 'production' | 'sandbox'

export function getSalesforceAppConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.SALESFORCE_CLIENT_ID
  const clientSecret = process.env.SALESFORCE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function loginHostFor(env: SfEnv): string {
  return env === 'sandbox' ? 'https://test.salesforce.com' : 'https://login.salesforce.com'
}

export function salesforceCallbackUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  return `${base}/api/integrations/salesforce/callback`
}
```

- [ ] **Step 4: Run the tests and confirm they pass.** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(salesforce): token cipher and app config`.

---

### Task 3: OAuth, connection store and connect/callback/disconnect routes

**Files:**
- Create: `src/features/salesforce/server/errors.ts`
- Create: `src/features/salesforce/server/oauth.ts` + `oauth.test.ts`
- Create: `src/features/salesforce/server/connection.ts` + `connection.test.ts`
- Create: `src/app/api/integrations/salesforce/connect/route.ts` + `route.test.ts`
- Create: `src/app/api/integrations/salesforce/callback/route.ts` + `route.test.ts`
- Create: `src/app/api/integrations/salesforce/route.ts` (DELETE) + `route.test.ts`

**Interfaces:**
- Consumes: Task 2 (`encryptToken`, `decryptToken`, `getSalesforceAppConfig`, `loginHostFor`, `salesforceCallbackUrl`, `SfEnv`).
- Produces:
  - **`errors.ts`:**
    - `class SalesforceAuthError extends Error`
    - `class SalesforceRateLimitError extends Error`
    - `class SalesforceApiError extends Error { status: number; errorCode: string }`
  - **`oauth.ts`:**
    - `SF_PKCE_COOKIE = 'sf_pkce'`
    - `signState({orgId, memberId, env}, now?)` and `verifyState(token, now?) → ConnectState | null`
    - `createPkcePair() → {verifier, challenge}`
    - `buildAuthorizeUrl({env, state, challenge})`
    - `exchangeCode({env, code, verifier}) → {accessToken, refreshToken, instanceUrl, idUrl}`
    - `fetchIdentity(idUrl, accessToken) → {userId, orgId, username, email}`
    - `refreshAccessToken(loginHost, refreshToken) → {accessToken, instanceUrl}` (throws `SalesforceAuthError` on `invalid_grant`)
    - `revokeToken(loginHost, token)`
  - **`connection.ts`:**
    - `getConnection(orgId)`
    - `saveConnection(orgId, memberId, data) → {orgChanged: boolean}`
    - `deleteConnection(orgId)`
    - `getAccessToken(orgId) → {accessToken, instanceUrl}`
    - `invalidateAccessToken(orgId)`
    - `markNeedsReconnect(orgId, message)`
    - `markRateLimited(orgId, until)`
    - `releaseExpiredRateLimits(now?)`
    - `isSalesforceActive(conn, now?) → boolean`

**Rulings carried into this task:**
- A reconnect to a different Salesforce org can't be detected before sign-in. So the callback detects it, clears the links, and redirects to `?salesforce=connected_new_org`. The card then shows the warning.
- `lastSalesforceOrgId` on Organization survives a disconnect so this detection still works.

- [ ] **Step 1: Write the failing `oauth.test.ts`.** Stub `fetch` with `vi.stubGlobal('fetch', vi.fn())`. Set `TOKEN_ENCRYPTION_KEY`, `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET` and `NEXT_PUBLIC_APP_URL` with `vi.stubEnv`. Cases:
  - **`signState`/`verifyState`:**
    - round-trips `{orgId, memberId, env}`
    - returns null after 10 minutes (`now + 600_001`)
    - returns null when one character of the payload or the signature is changed
    - returns null for garbage input
  - **`createPkcePair`:** the challenge equals `base64url(sha256(verifier))`, and the verifier is 43 or more characters.
  - **`buildAuthorizeUrl`:**
    - host `https://test.salesforce.com/services/oauth2/authorize` for sandbox
    - params `response_type=code`, `client_id`, `redirect_uri` (the callback URL), `scope=api refresh_token id`, `state`, `code_challenge`, `code_challenge_method=S256`
  - **`exchangeCode`:**
    - POSTs form-encoded `grant_type=authorization_code, code, client_id, client_secret, redirect_uri, code_verifier` to `<host>/services/oauth2/token`
    - maps `{access_token, refresh_token, instance_url, id}`
    - throws `SalesforceApiError` on a non-2xx response, carrying `error_description`
  - **`fetchIdentity`:** GETs the id URL with a Bearer token and maps `{user_id, organization_id, username, email}`.
  - **`refreshAccessToken`:** a 400 `{error:'invalid_grant'}` throws `SalesforceAuthError`; success maps `access_token` and `instance_url`.

- [ ] **Step 2: Implement `errors.ts` and `oauth.ts`**

```ts
// src/features/salesforce/server/errors.ts
export class SalesforceAuthError extends Error {
  constructor(message = 'Salesforce access was revoked or expired.') { super(message); this.name = 'SalesforceAuthError' }
}
export class SalesforceRateLimitError extends Error {
  constructor(message = 'Salesforce API limit reached for today.') { super(message); this.name = 'SalesforceRateLimitError' }
}
export class SalesforceApiError extends Error {
  constructor(public readonly status: number, public readonly errorCode: string, message: string) {
    super(message); this.name = 'SalesforceApiError'
  }
}
```

```ts
// src/features/salesforce/server/oauth.ts
import crypto from 'node:crypto'
import { getSalesforceAppConfig, loginHostFor, salesforceCallbackUrl, type SfEnv } from '../config'
import { SalesforceApiError, SalesforceAuthError } from './errors'

export const SF_PKCE_COOKIE = 'sf_pkce'
const STATE_TTL_MS = 10 * 60 * 1000

export interface ConnectState { orgId: string; memberId: string; env: SfEnv; nonce: string; exp: number }

function stateKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set')
  return crypto.createHash('sha256').update(`sf-state:${raw}`).digest()
}

export function signState(s: { orgId: string; memberId: string; env: SfEnv }, now = Date.now()): string {
  const payload: ConnectState = { ...s, nonce: crypto.randomBytes(12).toString('base64url'), exp: now + STATE_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', stateKey()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(token: string, now = Date.now()): ConnectState | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', stateKey()).update(body).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ConnectState
    if (typeof s.exp !== 'number' || s.exp < now) return null
    if (s.env !== 'production' && s.env !== 'sandbox') return null
    return s
  } catch {
    return null
  }
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function requireConfig() {
  const cfg = getSalesforceAppConfig()
  if (!cfg) throw new Error('Salesforce is not configured on this server')
  return cfg
}

export function buildAuthorizeUrl({ env, state, challenge }: { env: SfEnv; state: string; challenge: string }): string {
  const { clientId } = requireConfig()
  const url = new URL('/services/oauth2/authorize', loginHostFor(env))
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: salesforceCallbackUrl(),
    scope: 'api refresh_token id',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

async function tokenRequest(host: string, params: Record<string, string>) {
  const res = await fetch(`${host}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, string>
  return { ok: res.ok, status: res.status, data }
}

export async function exchangeCode({ env, code, verifier }: { env: SfEnv; code: string; verifier: string }) {
  const { clientId, clientSecret } = requireConfig()
  const { ok, status, data } = await tokenRequest(loginHostFor(env), {
    grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: salesforceCallbackUrl(), code_verifier: verifier,
  })
  if (!ok || !data.refresh_token || !data.access_token || !data.instance_url || !data.id) {
    throw new SalesforceApiError(status, data.error ?? 'TOKEN_EXCHANGE_FAILED', data.error_description ?? 'Salesforce token exchange failed')
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, instanceUrl: data.instance_url, idUrl: data.id }
}

export async function fetchIdentity(idUrl: string, accessToken: string) {
  const res = await fetch(idUrl, { headers: { Authorization: `Bearer ${accessToken}` } })
  const data = (await res.json().catch(() => ({}))) as Record<string, string>
  if (!res.ok) throw new SalesforceApiError(res.status, 'IDENTITY_FAILED', 'Could not read the Salesforce user')
  return { userId: data.user_id ?? '', orgId: data.organization_id ?? '', username: data.username ?? '', email: data.email ?? null }
}

export async function refreshAccessToken(loginHost: string, refreshToken: string) {
  const { clientId, clientSecret } = requireConfig()
  const { ok, status, data } = await tokenRequest(loginHost, {
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
  })
  if (!ok) {
    if (data.error === 'invalid_grant') throw new SalesforceAuthError(data.error_description ?? undefined)
    throw new SalesforceApiError(status, data.error ?? 'REFRESH_FAILED', data.error_description ?? 'Salesforce token refresh failed')
  }
  return { accessToken: data.access_token ?? '', instanceUrl: data.instance_url ?? '' }
}

export async function revokeToken(loginHost: string, token: string): Promise<void> {
  await fetch(`${loginHost}/services/oauth2/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  }).catch(() => undefined)
}
```

- [ ] **Step 3: Write the failing `connection.test.ts`.** Mock prisma the way `src/features/team/server/assign-owner.test.ts` does:
  - `salesforceConnection: findUnique, upsert, deleteMany, updateMany`
  - `organization: findUnique, update`
  - `lead: updateMany`
  - `$transaction` (implement it as `(fn) => fn(prismaMock)`)

  Also mock `./oauth` (`refreshAccessToken`) and `@/features/replies/server/notify` (`sendOrgAlert`). Cases:
  - `saveConnection` encrypts the refresh token: the stored `refreshTokenEnc` is not equal to the input, and `decryptToken` of it equals the input. It upserts with `status: 'CONNECTED'`, `lastError: null` and `rateLimitedUntil: null`, and sets `organization.lastSalesforceOrgId`.
  - `saveConnection` returns `{orgChanged: true}` and clears the org's lead links (all 8 lead Salesforce fields set to null or false) when `lastSalesforceOrgId` is set and differs. It returns `orgChanged: false` when that value is null or the same.
  - `getAccessToken`:
    - calls `refreshAccessToken` once, then serves the cached token on the second call
    - after `invalidateAccessToken`, refreshes again
    - on a `SalesforceAuthError`, calls `markNeedsReconnect` and rethrows
  - `markNeedsReconnect` uses `updateMany({ where: { organizationId, status: { not: 'NEEDS_RECONNECT' } } })` and alerts only when `count === 1`. The alert subject is `'Salesforce disconnected'` and the body mentions reconnecting in Settings.
  - `markRateLimited` alerts only on the transition from `CONNECTED` (`count === 1`), with subject `'Salesforce API limit reached'`.
  - `isSalesforceActive`: `CONNECTED` → true; `NEEDS_RECONNECT` → false; `RATE_LIMITED` with `rateLimitedUntil` in the future → false; `RATE_LIMITED` with it in the past → true.
  - `releaseExpiredRateLimits` does an updateMany of `RATE_LIMITED` rows with `rateLimitedUntil <= now` to `CONNECTED`.

- [ ] **Step 4: Implement `connection.ts`**

```ts
// src/features/salesforce/server/connection.ts
import type { SalesforceConnection } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { refreshAccessToken } from './oauth'
import { SalesforceAuthError } from './errors'

const TOKEN_TTL_MS = 50 * 60 * 1000 // Salesforce sessions last >= 2h by default; refresh well before.
const tokenCache = new Map<string, { accessToken: string; instanceUrl: string; at: number }>()

export const CLEARED_LEAD_LINK = {
  salesforceId: null, salesforceType: null, salesforceAccountId: null,
  sfCheckStatus: null, sfCheckedAt: null, sfCheckDetail: null, sfBlockOverride: false, sfHeldSince: null,
} as const

export function getConnection(organizationId: string): Promise<SalesforceConnection | null> {
  return prisma.salesforceConnection.findUnique({ where: { organizationId } })
}

export interface SaveConnectionInput {
  instanceUrl: string; loginHost: string; sfOrgId: string; sfUserId: string
  sfUsername: string; sfUserEmail: string | null; refreshToken: string
}

export async function saveConnection(organizationId: string, memberId: string, d: SaveConnectionInput) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { lastSalesforceOrgId: true } })
  const orgChanged = !!org?.lastSalesforceOrgId && org.lastSalesforceOrgId !== d.sfOrgId
  const fields = {
    instanceUrl: d.instanceUrl, loginHost: d.loginHost, sfOrgId: d.sfOrgId, sfUserId: d.sfUserId,
    sfUsername: d.sfUsername, sfUserEmail: d.sfUserEmail, refreshTokenEnc: encryptToken(d.refreshToken),
    status: 'CONNECTED' as const, lastError: null, rateLimitedUntil: null, connectedAt: new Date(),
    connectedByMemberId: memberId,
  }
  await prisma.$transaction(async (tx) => {
    if (orgChanged) await tx.lead.updateMany({ where: { organizationId }, data: CLEARED_LEAD_LINK })
    await tx.salesforceConnection.upsert({ where: { organizationId }, create: { organizationId, ...fields }, update: fields })
    await tx.organization.update({ where: { id: organizationId }, data: { lastSalesforceOrgId: d.sfOrgId } })
  })
  tokenCache.delete(organizationId)
  return { orgChanged }
}

export async function deleteConnection(organizationId: string): Promise<void> {
  tokenCache.delete(organizationId)
  await prisma.salesforceConnection.deleteMany({ where: { organizationId } })
}

export function invalidateAccessToken(organizationId: string): void {
  tokenCache.delete(organizationId)
}

export async function getAccessToken(organizationId: string): Promise<{ accessToken: string; instanceUrl: string }> {
  const cached = tokenCache.get(organizationId)
  if (cached && Date.now() - cached.at < TOKEN_TTL_MS) return cached
  const conn = await getConnection(organizationId)
  if (!conn) throw new SalesforceAuthError('Salesforce is not connected.')
  try {
    const t = await refreshAccessToken(conn.loginHost, decryptToken(conn.refreshTokenEnc))
    const entry = { accessToken: t.accessToken, instanceUrl: t.instanceUrl || conn.instanceUrl, at: Date.now() }
    tokenCache.set(organizationId, entry)
    return entry
  } catch (err) {
    if (err instanceof SalesforceAuthError) await markNeedsReconnect(organizationId, err.message)
    throw err
  }
}

export async function markNeedsReconnect(organizationId: string, message: string): Promise<void> {
  tokenCache.delete(organizationId)
  const res = await prisma.salesforceConnection.updateMany({
    where: { organizationId, status: { not: 'NEEDS_RECONNECT' } },
    data: { status: 'NEEDS_RECONNECT', lastError: message },
  })
  if (res.count === 1) {
    await sendOrgAlert(organizationId, 'Salesforce disconnected',
      `OutboundOS lost access to Salesforce (${message}).\n\nSending continues, but activity logging and customer checks are paused. An admin can reconnect in Settings → Salesforce.`)
  }
}

export async function markRateLimited(organizationId: string, until: Date): Promise<void> {
  const res = await prisma.salesforceConnection.updateMany({
    where: { organizationId, status: 'CONNECTED' },
    data: { status: 'RATE_LIMITED', rateLimitedUntil: until },
  })
  if (res.count === 1) {
    await sendOrgAlert(organizationId, 'Salesforce API limit reached',
      `Your Salesforce org has used 80% of today's API calls, so OutboundOS paused its Salesforce work until ${until.toISOString()}.\n\nSends to leads with a recent Salesforce check continue.`)
  }
}

export async function releaseExpiredRateLimits(now: Date = new Date()): Promise<void> {
  await prisma.salesforceConnection.updateMany({
    where: { status: 'RATE_LIMITED', rateLimitedUntil: { lte: now } },
    data: { status: 'CONNECTED', rateLimitedUntil: null },
  })
}

export function isSalesforceActive(conn: Pick<SalesforceConnection, 'status' | 'rateLimitedUntil'>, now: Date = new Date()): boolean {
  if (conn.status === 'CONNECTED') return true
  if (conn.status === 'RATE_LIMITED') return !!conn.rateLimitedUntil && conn.rateLimitedUntil <= now
  return false
}
```

- [ ] **Step 5: Write the failing route tests, then implement the three routes.** Mock `resolveMember`, `../../../../features/salesforce/server/oauth` (or the `@/` path), `connection`, and `getSalesforceAppConfig`.

**`connect/route.ts` (GET):**
- `resolveMember` null → 403 `{error:'No active organization.'}`
- non-admin → 403 `ADMIN_ONLY`
- config null → redirect to `/settings?salesforce=error&reason=not_configured`
- `env` query param not `production|sandbox` → default to `production`
- otherwise:
  - `createPkcePair()`, `signState({orgId: ctx.org.id, memberId: ctx.member.id, env})`
  - redirect to `buildAuthorizeUrl(...)`
  - set cookie `SF_PKCE_COOKIE` = verifier with `{ httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/api/integrations/salesforce' }`
- **Tests:** 403 for no org; 403 ADMIN_ONLY for a member (and `signState` not called); redirect for an admin, with the cookie set and path `/api/integrations/salesforce`; sandbox passed through.

**`callback/route.ts` (GET):**
- Every failure redirects to `/settings?salesforce=error&reason=<code>`, using `new URL(path, request.url)`, and deletes the PKCE cookie. Codes:
  - `denied` when the query has `error`
  - `not_admin` when `resolveMember` is null or not admin
  - `state` when `verifyState` returns null or `state.orgId !== ctx.org.id`
  - `pkce` when the cookie is missing
  - `exchange` when `exchangeCode`, `fetchIdentity` or `saveConnection` throws (log it with `console.error`)
- On success:
  - `saveConnection(ctx.org.id, ctx.member.id, {instanceUrl, loginHost: loginHostFor(state.env), sfOrgId, sfUserId, sfUsername: username, sfUserEmail: email, refreshToken})`
  - redirect to `/settings?salesforce=connected`, or `connected_new_org` when `orgChanged`
- **Tests:** each failure code; a member never reaches `exchangeCode`; a state for another org → `state`; success → `saveConnection` called with the mapped values; `orgChanged` → `connected_new_org`.

**`route.ts` (DELETE):**
- no org → 403; non-admin → 403 ADMIN_ONLY
- if connected, best-effort `revokeToken(conn.loginHost, decryptToken(conn.refreshTokenEnc))` inside try/catch, then `deleteConnection`
- returns `{ok:true}`; 200 even when not connected
- **Tests:** a member is blocked; an admin revokes and deletes; a revoke failure still deletes.

- [ ] **Step 6: Run and commit**

Run: `npx vitest run src/features/salesforce src/app/api/integrations/salesforce && npx tsc --noEmit`
Expected: PASS.

Commit with the message `feat(salesforce): OAuth connect, encrypted connection store, disconnect`.

---

### Task 4: Salesforce REST client and owner matching

**Files:**
- Create: `src/features/salesforce/server/client.ts` + `client.test.ts`
- Create: `src/features/salesforce/server/owner-match.ts` + `owner-match.test.ts`

**Interfaces:**
- Consumes: Task 3 (`getAccessToken`, `invalidateAccessToken`, `markNeedsReconnect`, `markRateLimited`, the error classes); `SF_API_VERSION`.
- Produces:
  - `soqlString(v: string): string` (returns a quoted, escaped literal)
  - `chunk<T>(xs: T[], size: number): T[][]`
  - `interface SfClient { orgId: string; query<T>(soql: string): Promise<T[]>; listViews(sobject: 'Lead' | 'Contact'): Promise<{ id: string; label: string }[]>; listViewIds(sobject, listViewId, opts: { limit: number; offset: number }): Promise<{ ids: string[]; size: number }>; create(sobject: string, fields: Record<string, unknown>): Promise<string> }`
  - `getSalesforceClient(orgId): SfClient`
  - `resolveSfUserId(client: SfClient, organizationId: string, ownerMemberId: string | null): Promise<string>`

- [ ] **Step 1: Write the failing `client.test.ts`.** Mock `./connection` so `getAccessToken` resolves to `{accessToken: 't1', instanceUrl: 'https://acme.my.salesforce.com'}`, and stub `fetch`. Cases:
  - **`soqlString`:**
    - `soqlString("o'brien@acme.com")` → `'o\\'brien@acme.com'`, i.e. the characters `'o\'brien@acme.com'`
    - `soqlString('a\\b')` → the characters `'a\\b'`, with the backslash doubled
    - newlines are escaped as `\n`
  - **`query`:**
    - GETs `/services/data/v62.0/query?q=<encoded>` with `Authorization: Bearer t1`
    - follows `nextRecordsUrl` until `done: true`, concatenating `records`
    - strips the `attributes` key from records
  - **Retry on 401:** a 401 first calls `invalidateAccessToken`, fetches a new token and retries once. A second 401 calls `markNeedsReconnect` and throws `SalesforceAuthError`.
  - **Error mapping:**
    - 403 with body `[{errorCode:'REQUEST_LIMIT_EXCEEDED', message:'...'}]` → `SalesforceRateLimitError`, and `markRateLimited` is called
    - 400 with body `[{errorCode:'REQUIRED_FIELD_MISSING', message:'Required fields are missing: [Industry]'}]` → `SalesforceApiError` with `errorCode === 'REQUIRED_FIELD_MISSING'` and that message
  - **Usage header:** a `Sforce-Limit-Info: api-usage=80/100` response header calls `markRateLimited(orgId, <next UTC midnight>)`. `api-usage=79/100` does not.
  - **`listViews`:** follows `nextRecordsUrl` and returns `{id, label}`.
  - **`listViewIds`:** GETs `/sobjects/Lead/listviews/<id>/results?limit=200&offset=0` and extracts the `Id` column value from each `records[].columns[]` where `fieldNameOrPath === 'Id'`. Returns `size`.
  - **`create`:** POSTs JSON to `/sobjects/Task/`, returns `id`, and throws `SalesforceApiError` when `success: false`.

- [ ] **Step 2: Implement `client.ts`**

```ts
// src/features/salesforce/server/client.ts
import { SF_API_VERSION } from '../config'
import { getAccessToken, invalidateAccessToken, markNeedsReconnect, markRateLimited } from './connection'
import { SalesforceApiError, SalesforceAuthError, SalesforceRateLimitError } from './errors'

const RATE_LIMIT_THRESHOLD = 0.8

export function soqlString(v: string): string {
  const escaped = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')
  return `'${escaped}'`
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

function nextUtcMidnight(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

export interface SfClient {
  orgId: string
  query<T>(soql: string): Promise<T[]>
  listViews(sobject: 'Lead' | 'Contact'): Promise<{ id: string; label: string }[]>
  listViewIds(sobject: 'Lead' | 'Contact', listViewId: string, opts: { limit: number; offset: number }): Promise<{ ids: string[]; size: number }>
  create(sobject: string, fields: Record<string, unknown>): Promise<string>
}

function stripAttributes<T>(r: Record<string, unknown>): T {
  const { attributes: _a, ...rest } = r
  for (const [k, v] of Object.entries(rest)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'attributes' in (v as object)) {
      rest[k] = stripAttributes(v as Record<string, unknown>)
    }
  }
  return rest as T
}

export function getSalesforceClient(orgId: string): SfClient {
  async function request(path: string, init: RequestInit = {}, retried = false): Promise<unknown> {
    const { accessToken, instanceUrl } = await getAccessToken(orgId)
    const url = path.startsWith('http') ? path : `${instanceUrl}${path}`
    const res = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    })

    const usage = res.headers.get('Sforce-Limit-Info')?.match(/api-usage=(\d+)\/(\d+)/)
    if (usage && Number(usage[2]) > 0 && Number(usage[1]) / Number(usage[2]) >= RATE_LIMIT_THRESHOLD) {
      await markRateLimited(orgId, nextUtcMidnight())
    }

    if (res.status === 401) {
      invalidateAccessToken(orgId)
      if (!retried) return request(path, init, true)
      await markNeedsReconnect(orgId, 'Salesforce rejected the access token')
      throw new SalesforceAuthError()
    }

    const data = (await res.json().catch(() => null)) as unknown
    if (!res.ok) {
      const first = Array.isArray(data) ? (data[0] as { errorCode?: string; message?: string } | undefined) : undefined
      const errorCode = first?.errorCode ?? `HTTP_${res.status}`
      if (errorCode === 'REQUEST_LIMIT_EXCEEDED') {
        await markRateLimited(orgId, nextUtcMidnight())
        throw new SalesforceRateLimitError()
      }
      throw new SalesforceApiError(res.status, errorCode, first?.message ?? `Salesforce request failed (${res.status})`)
    }
    return data
  }

  const base = `/services/data/${SF_API_VERSION}`

  return {
    orgId,
    async query<T>(soql: string): Promise<T[]> {
      const out: T[] = []
      let page = (await request(`${base}/query?q=${encodeURIComponent(soql)}`)) as { records: Record<string, unknown>[]; done: boolean; nextRecordsUrl?: string }
      out.push(...page.records.map((r) => stripAttributes<T>(r)))
      while (!page.done && page.nextRecordsUrl) {
        page = (await request(page.nextRecordsUrl)) as typeof page
        out.push(...page.records.map((r) => stripAttributes<T>(r)))
      }
      return out
    },
    async listViews(sobject) {
      const out: { id: string; label: string }[] = []
      let page = (await request(`${base}/sobjects/${sobject}/listviews`)) as { listviews: { id: string; label: string }[]; done?: boolean; nextRecordsUrl?: string | null }
      out.push(...page.listviews.map((v) => ({ id: v.id, label: v.label })))
      while (page.done === false && page.nextRecordsUrl) {
        page = (await request(page.nextRecordsUrl)) as typeof page
        out.push(...page.listviews.map((v) => ({ id: v.id, label: v.label })))
      }
      return out
    },
    async listViewIds(sobject, listViewId, { limit, offset }) {
      const data = (await request(
        `${base}/sobjects/${sobject}/listviews/${encodeURIComponent(listViewId)}/results?limit=${limit}&offset=${offset}`,
      )) as { size: number; records: { columns: { fieldNameOrPath: string; value: string | null }[] }[] }
      const ids = data.records
        .map((r) => r.columns.find((c) => c.fieldNameOrPath === 'Id')?.value)
        .filter((v): v is string => !!v)
      return { ids, size: data.size }
    },
    async create(sobject, fields) {
      const data = (await request(`${base}/sobjects/${sobject}/`, { method: 'POST', body: JSON.stringify(fields) })) as { id?: string; success?: boolean; errors?: { statusCode?: string; message?: string }[] }
      if (!data.success || !data.id) {
        const e = data.errors?.[0]
        throw new SalesforceApiError(400, e?.statusCode ?? 'CREATE_FAILED', e?.message ?? `Could not create ${sobject}`)
      }
      return data.id
    },
  }
}
```

- [ ] **Step 3: Write the failing `owner-match.test.ts`.** Mock prisma: `orgMember.findMany` returns emails, and `salesforceConnection.findUnique` returns `sfUserId`. Give it a fake `SfClient` whose `query` records the SOQL. Cases:
  - the member's email matches an active SF User → that User's Id is returned
  - no member (`null`) or no match → the connection's `sfUserId`
  - the second call within 1 hour doesn't query again (the cache is per org)
  - the email comparison is case-insensitive
  - the SOQL uses `soqlString` for every email and includes `IsActive = true`

- [ ] **Step 4: Implement `owner-match.ts`**

```ts
// src/features/salesforce/server/owner-match.ts
import { prisma } from '@/lib/db/prisma'
import { chunk, soqlString, type SfClient } from './client'

const CACHE_MS = 60 * 60 * 1000
const cache = new Map<string, { at: number; byMemberId: Map<string, string> }>()

async function load(client: SfClient, organizationId: string): Promise<Map<string, string>> {
  const hit = cache.get(organizationId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.byMemberId
  const members = await prisma.orgMember.findMany({ where: { organizationId, email: { not: null } }, select: { id: true, email: true } })
  const emails = [...new Set(members.map((m) => (m.email ?? '').toLowerCase()).filter(Boolean))]
  const userByEmail = new Map<string, string>()
  for (const part of chunk(emails, 200)) {
    const users = await client.query<{ Id: string; Email: string }>(
      `SELECT Id, Email FROM User WHERE IsActive = true AND Email IN (${part.map(soqlString).join(', ')})`,
    )
    for (const u of users) userByEmail.set(u.Email.toLowerCase(), u.Id)
  }
  const byMemberId = new Map<string, string>()
  for (const m of members) {
    const id = userByEmail.get((m.email ?? '').toLowerCase())
    if (id) byMemberId.set(m.id, id)
  }
  cache.set(organizationId, { at: Date.now(), byMemberId })
  return byMemberId
}

/** The Salesforce User to own records for this rep; falls back to the connected user. */
export async function resolveSfUserId(client: SfClient, organizationId: string, ownerMemberId: string | null): Promise<string> {
  const conn = await prisma.salesforceConnection.findUnique({ where: { organizationId }, select: { sfUserId: true } })
  const fallback = conn?.sfUserId ?? ''
  if (!ownerMemberId) return fallback
  const map = await load(client, organizationId)
  return map.get(ownerMemberId) ?? fallback
}

export function clearOwnerMatchCache(): void {
  cache.clear()
}
```

  Call `clearOwnerMatchCache()` in the test `beforeEach`. If `orgMember.email` is non-nullable in the schema, drop the `{ not: null }` filter.

- [ ] **Step 5: Run and commit**

Run: `npx vitest run src/features/salesforce && npx tsc --noEmit`
Expected: PASS.

Commit with the message `feat(salesforce): REST client with refresh, limits and owner matching`.

---

### Task 5: Record fetching and classification

**Files:**
- Create: `src/features/salesforce/classify.ts` + `classify.test.ts` (pure)
- Create: `src/features/salesforce/server/records.ts` + `records.test.ts`

**Interfaces:**
- Consumes: Task 4 (`SfClient`, `soqlString`, `chunk`).
- Produces:
  - **`classify.ts`:**
    - `type SfStatus = 'CLEAR' | 'CUSTOMER' | 'OPEN_OPPORTUNITY' | 'OPTED_OUT' | 'CONVERTED' | 'NOT_FOUND'`
    - `BLOCKING: ReadonlySet<SfStatus>` = {OPTED_OUT, CONVERTED, CUSTOMER, OPEN_OPPORTUNITY}
    - `interface ClassifyRules { customerAccountTypes: string[]; blockOpenOpportunities: boolean }`
    - `classifySfRecord(p: SfPerson, rules): { status: SfStatus; detail: string | null }`
    - `mostRestrictive(results): { status; detail }` (an empty array → `NOT_FOUND`)
    - `SKIP_KEY: Record<SfStatus, 'optedOut' | 'converted' | 'customer' | 'openOpportunity' | null>`
    - `blockReason(status, detail): string`, e.g. `'Salesforce: customer (Acme Property Group)'`
  - **`records.ts`:**
    - `interface SfPerson { type: 'LEAD' | 'CONTACT'; id: string; email: string | null; firstName: string | null; lastName: string | null; company: string | null; title: string | null; phone: string | null; state: string | null; country: string | null; postalCode: string | null; ownerEmail: string | null; accountId: string | null; accountName: string | null; accountType: string | null; hasOptedOut: boolean; isConverted: boolean; hasOpenOpp: boolean }`
    - `fetchPeople(client, object: 'Lead' | 'Contact', by: { ids: string[] } | { emails: string[] }): Promise<SfPerson[]>`
    - `lookupByEmails(client, emails: string[], rules): Promise<Map<string, { status: SfStatus; detail: string | null; person: SfPerson | null }>>`, keyed by the lower-cased email. The person to link is the best record: a Contact if any, else a non-converted Lead, else null.

The classification order is priority order, most restrictive first: OPTED_OUT > CONVERTED > CUSTOMER > OPEN_OPPORTUNITY > CLEAR > NOT_FOUND.

- [ ] **Step 1: Write the failing `classify.test.ts`:**
  - opted out wins over customer on the same record
  - a converted Lead → CONVERTED
  - a Contact with `accountType: 'customer'` and rules `['Customer']` → CUSTOMER (case-insensitive), with detail = the account name
  - a Contact with an open opp and `blockOpenOpportunities: true` → OPEN_OPPORTUNITY. With the rule false → CLEAR.
  - a Lead with none of these flags → CLEAR
  - `mostRestrictive([{CLEAR}, {CONVERTED}])` → CONVERTED (Review Focus 2)
  - `mostRestrictive([])` → NOT_FOUND
  - `blockReason('OPEN_OPPORTUNITY', 'Acme')` → `'Salesforce: open opportunity (Acme)'`
  - `blockReason('OPTED_OUT', null)` → `'Salesforce: opted out'`

- [ ] **Step 2: Implement `classify.ts`**

```ts
// src/features/salesforce/classify.ts
import type { SfPerson } from './server/records'

export type SfStatus = 'CLEAR' | 'CUSTOMER' | 'OPEN_OPPORTUNITY' | 'OPTED_OUT' | 'CONVERTED' | 'NOT_FOUND'
export const BLOCKING: ReadonlySet<SfStatus> = new Set(['OPTED_OUT', 'CONVERTED', 'CUSTOMER', 'OPEN_OPPORTUNITY'])
const RANK: Record<SfStatus, number> = { OPTED_OUT: 5, CONVERTED: 4, CUSTOMER: 3, OPEN_OPPORTUNITY: 2, CLEAR: 1, NOT_FOUND: 0 }
const LABEL: Record<SfStatus, string> = {
  OPTED_OUT: 'opted out', CONVERTED: 'converted lead', CUSTOMER: 'customer',
  OPEN_OPPORTUNITY: 'open opportunity', CLEAR: 'clear', NOT_FOUND: 'not in Salesforce',
}
export const SKIP_KEY: Record<SfStatus, 'optedOut' | 'converted' | 'customer' | 'openOpportunity' | null> = {
  OPTED_OUT: 'optedOut', CONVERTED: 'converted', CUSTOMER: 'customer', OPEN_OPPORTUNITY: 'openOpportunity', CLEAR: null, NOT_FOUND: null,
}

export interface ClassifyRules { customerAccountTypes: string[]; blockOpenOpportunities: boolean }
export interface SfCheck { status: SfStatus; detail: string | null }

export function classifySfRecord(p: SfPerson, rules: ClassifyRules): SfCheck {
  if (p.hasOptedOut) return { status: 'OPTED_OUT', detail: null }
  if (p.type === 'LEAD' && p.isConverted) return { status: 'CONVERTED', detail: p.company }
  const customerTypes = new Set(rules.customerAccountTypes.map((t) => t.trim().toLowerCase()).filter(Boolean))
  if (p.type === 'CONTACT' && p.accountType && customerTypes.has(p.accountType.toLowerCase())) {
    return { status: 'CUSTOMER', detail: p.accountName }
  }
  if (p.type === 'CONTACT' && rules.blockOpenOpportunities && p.hasOpenOpp) {
    return { status: 'OPEN_OPPORTUNITY', detail: p.accountName }
  }
  return { status: 'CLEAR', detail: null }
}

export function mostRestrictive(results: SfCheck[]): SfCheck {
  return results.reduce<SfCheck>((best, r) => (RANK[r.status] > RANK[best.status] ? r : best), { status: 'NOT_FOUND', detail: null })
}

export function blockReason(status: SfStatus, detail: string | null): string {
  return `Salesforce: ${LABEL[status]}${detail ? ` (${detail})` : ''}`
}
```

- [ ] **Step 3: Write the failing `records.test.ts`.** Use a fake client whose `query` returns canned rows keyed by `FROM Lead` / `FROM Contact` / `FROM Opportunity`, and records every SOQL string. Cases:
  - `fetchPeople(client, 'Lead', {ids})`:
    - the SOQL selects `Id, FirstName, LastName, Email, Company, Title, Phone, State, Country, PostalCode, HasOptedOutOfEmail, IsConverted, Owner.Email`, with `WHERE Id IN (...)` built by `soqlString`
    - it maps to `SfPerson` with `type: 'LEAD'`, `accountId: null` and `hasOpenOpp: false`
    - the email is lower-cased
  - `fetchPeople(client, 'Contact', {emails})`:
    - the SOQL selects `Id, FirstName, LastName, Email, Title, Phone, MailingState, MailingCountry, MailingPostalCode, HasOptedOutOfEmail, AccountId, Account.Name, Account.Type, Owner.Email`
    - it runs `SELECT AccountId FROM Opportunity WHERE IsClosed = false AND AccountId IN (...)` once for the distinct AccountIds
    - it sets `hasOpenOpp` and `company = Account.Name`
    - the Opportunity query is skipped when no contact has an AccountId
  - 450 emails → 3 chunks per object (200 + 200 + 50)
  - an email `o'brien@acme.com` appears in the SOQL as `'o\'brien@acme.com'` (Review Focus 3)
  - `lookupByEmails`:
    - an email found as a CLEAR Contact and a converted Lead → status CONVERTED, and `person` is the Contact
    - an email not found → `{status:'NOT_FOUND', detail:null, person:null}`
    - a key is present for every requested email (lower-cased)

- [ ] **Step 4: Implement `records.ts`**

```ts
// src/features/salesforce/server/records.ts
import { chunk, soqlString, type SfClient } from './client'
import { classifySfRecord, mostRestrictive, type ClassifyRules, type SfStatus } from '../classify'

export interface SfPerson {
  type: 'LEAD' | 'CONTACT'; id: string; email: string | null
  firstName: string | null; lastName: string | null; company: string | null; title: string | null; phone: string | null
  state: string | null; country: string | null; postalCode: string | null; ownerEmail: string | null
  accountId: string | null; accountName: string | null; accountType: string | null
  hasOptedOut: boolean; isConverted: boolean; hasOpenOpp: boolean
}

const LEAD_FIELDS = 'Id, FirstName, LastName, Email, Company, Title, Phone, State, Country, PostalCode, HasOptedOutOfEmail, IsConverted, Owner.Email'
const CONTACT_FIELDS = 'Id, FirstName, LastName, Email, Title, Phone, MailingState, MailingCountry, MailingPostalCode, HasOptedOutOfEmail, AccountId, Account.Name, Account.Type, Owner.Email'

type Row = Record<string, unknown>
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const rel = (r: Row, k: string): Row | null => (r[k] && typeof r[k] === 'object' ? (r[k] as Row) : null)

export async function fetchPeople(client: SfClient, object: 'Lead' | 'Contact', by: { ids: string[] } | { emails: string[] }): Promise<SfPerson[]> {
  const field = 'ids' in by ? 'Id' : 'Email'
  const values = [...new Set('ids' in by ? by.ids : by.emails.map((e) => e.toLowerCase()))]
  const rows: Row[] = []
  for (const part of chunk(values, 200)) {
    const fields = object === 'Lead' ? LEAD_FIELDS : CONTACT_FIELDS
    rows.push(...(await client.query<Row>(`SELECT ${fields} FROM ${object} WHERE ${field} IN (${part.map(soqlString).join(', ')})`)))
  }

  if (object === 'Lead') {
    return rows.map((r) => ({
      type: 'LEAD', id: String(r.Id), email: s(r.Email)?.toLowerCase() ?? null,
      firstName: s(r.FirstName), lastName: s(r.LastName), company: s(r.Company), title: s(r.Title), phone: s(r.Phone),
      state: s(r.State), country: s(r.Country), postalCode: s(r.PostalCode), ownerEmail: s(rel(r, 'Owner')?.Email),
      accountId: null, accountName: null, accountType: null,
      hasOptedOut: r.HasOptedOutOfEmail === true, isConverted: r.IsConverted === true, hasOpenOpp: false,
    }))
  }

  const accountIds = [...new Set(rows.map((r) => s(r.AccountId)).filter((v): v is string => !!v))]
  const withOpenOpp = new Set<string>()
  for (const part of chunk(accountIds, 200)) {
    const opps = await client.query<{ AccountId: string }>(
      `SELECT AccountId FROM Opportunity WHERE IsClosed = false AND AccountId IN (${part.map(soqlString).join(', ')})`,
    )
    for (const o of opps) withOpenOpp.add(o.AccountId)
  }
  return rows.map((r) => {
    const account = rel(r, 'Account')
    const accountId = s(r.AccountId)
    return {
      type: 'CONTACT', id: String(r.Id), email: s(r.Email)?.toLowerCase() ?? null,
      firstName: s(r.FirstName), lastName: s(r.LastName), company: s(account?.Name), title: s(r.Title), phone: s(r.Phone),
      state: s(r.MailingState), country: s(r.MailingCountry), postalCode: s(r.MailingPostalCode), ownerEmail: s(rel(r, 'Owner')?.Email),
      accountId, accountName: s(account?.Name), accountType: s(account?.Type),
      hasOptedOut: r.HasOptedOutOfEmail === true, isConverted: false, hasOpenOpp: !!accountId && withOpenOpp.has(accountId),
    }
  })
}

export async function lookupByEmails(client: SfClient, emails: string[], rules: ClassifyRules) {
  const keys = [...new Set(emails.map((e) => e.toLowerCase()))]
  const people = [...(await fetchPeople(client, 'Contact', { emails: keys })), ...(await fetchPeople(client, 'Lead', { emails: keys }))]
  const out = new Map<string, { status: SfStatus; detail: string | null; person: SfPerson | null }>()
  for (const email of keys) {
    const matches = people.filter((p) => p.email === email)
    const check = mostRestrictive(matches.map((p) => classifySfRecord(p, rules)))
    const person = matches.find((p) => p.type === 'CONTACT') ?? matches.find((p) => p.type === 'LEAD' && !p.isConverted) ?? null
    out.set(email, { ...check, person })
  }
  return out
}
```

- [ ] **Step 5: Run and commit**

Run: `npx vitest run src/features/salesforce && npx tsc --noEmit`
Expected: PASS.

Commit with the message `feat(salesforce): record fetching and do-not-email classification`.

---

### Task 6: Pre-send check (`ensureSalesforceClear`) and `applySalesforceBlock`

**Files:**
- Create: `src/features/salesforce/server/check.ts` + `check.test.ts`

**Interfaces:**
- Consumes:
  - Task 3: `getConnection`, `isSalesforceActive`
  - Task 4: `getSalesforceClient`
  - Task 5: `lookupByEmails`, `BLOCKING`, `blockReason`
  - `sendOrgAlert`
- Produces:
  - `SF_FRESH_MS = 24h`, `SF_STALE_OK_MS = 7d`, `SF_HOLD_MS = 10 min`
  - `interface ClearResult { allowed: Set<string>; held: Set<string>; blocked: Map<string, string> }` (leadId → reason)
  - `ensureSalesforceClear(organizationId: string, leadIds: string[], now?: Date): Promise<ClearResult>`
  - `applySalesforceBlock(organizationId: string, leadId: string, reason: string, opts?: { exceptMessageId?: string }): Promise<void>`
  - `prefetchSalesforceChecks(leadIds: string[], now?: Date): Promise<void>`. Groups the leads by org and calls `ensureSalesforceClear`. It never throws.

**Rules** (spec §5):

- **Not connected, or no connection row:** every lead is allowed. Nothing is written.
- **For each lead:**
  - `sfBlockOverride` → allowed.
  - `sfCheckedAt` newer than 24h → decided from `sfCheckStatus`: a blocking status → blocked; otherwise allowed. `NOT_FOUND` and null count as clear.
  - Otherwise the lead needs a lookup.
- **If lookups are needed and `isSalesforceActive(conn)`:** one `lookupByEmails` call for all of them. Then write, per lead, `sfCheckStatus`, `sfCheckDetail` and `sfCheckedAt: now`, with `sfHeldSince: null`. Also set the link fields (`salesforceId`, `salesforceType`, `salesforceAccountId`) when the lead's `salesforceId` is null and a `person` was found. Decide from the new status.
- **If the lookup throws, or the connection isn't active:**
  - A lead whose `sfCheckedAt` is newer than 7 days → decided from its stored status.
  - Otherwise → held. Set `sfHeldSince: now` on held leads where it is null.
- **Held alert:** when anything is held, count the org's leads with `sfHeldSince < now - 24h`. If there are any and `conn.heldAlertedAt` is null or older than 24h, send `sendOrgAlert(orgId, 'Salesforce checks are holding emails', ...)` and set `heldAlertedAt: now`.
- **Blocked reasons** use `blockReason(status, detail)`.

**`applySalesforceBlock`** runs as one `$transaction`:
- `sequenceEnrollment.updateMany({ where: { organizationId, leadId, status: { in: ['ACTIVE', 'PAUSED'] } }, data: { status: 'STOPPED', stoppedAt: new Date(), stoppedReason: reason, processing: false } })`
- `draft.updateMany({ where: { organizationId, leadId, status: { in: ['PENDING_REVIEW', 'APPROVED'] }, outboundMessage: { is: null } }, data: { status: 'BLOCKED' } })`. Check the Draft → OutboundMessage relation name in the schema, and use the actual field name.
- `outboundMessage.updateMany({ where: { organizationId, leadId, status: 'QUEUED', processing: false, ...(exceptMessageId && { id: { not: exceptMessageId } }) }, data: { status: 'CANCELLED', lastError: reason } })`
- Then `console.info` one line naming the lead and the reason.

- [ ] **Step 1: Write the failing `check.test.ts`.** Mock prisma (`lead.findMany/update/updateMany/count`, `salesforceConnection.update`, `sequenceEnrollment.updateMany`, `draft.updateMany`, `outboundMessage.updateMany`, `$transaction`), `./connection`, `./client`, `./records` and `notify`. Cases:
  1. No connection → all allowed, and `lookupByEmails` is not called.
  2. `sfBlockOverride` lead with `sfCheckStatus: 'CUSTOMER'` → allowed.
  3. A fresh (1h) CUSTOMER → blocked with reason `'Salesforce: customer (Acme)'`, and no lookup. A fresh CLEAR → allowed.
  4. A stale (3 days) lead + active connection → one lookup call with the emails, the result written with `sfCheckedAt: now` and `sfHeldSince: null`, and the link set when the lead had no `salesforceId`. An existing link is not overwritten.
  5. The lookup throws; a lead checked 3 days ago as CLEAR → allowed; a lead checked 8 days ago → held with `sfHeldSince` set (Review Focus 1); a never-checked lead → held.
  6. Connection `NEEDS_RECONNECT` → no lookup, and the rule-5 decisions apply.
  7. The held alert fires once: `count` returns 1 and `heldAlertedAt` is null → `sendOrgAlert` is called and `heldAlertedAt` is updated. With `heldAlertedAt` 2h ago → no alert.
  8. `applySalesforceBlock` issues the three `updateMany` calls with the exact `where` clauses above, and passes `exceptMessageId` through.
  9. `prefetchSalesforceChecks` groups leads from two orgs into two calls and swallows an error from one.

- [ ] **Step 2: Implement `check.ts`** to the rules above. Keep the logic in small helpers: `decideFromStored(lead, now, maxAgeMs)` returns `'allowed' | 'blocked' | null`. Select these lead fields: `id, organizationId, email, salesforceId, sfCheckStatus, sfCheckDetail, sfCheckedAt, sfBlockOverride, sfHeldSince`.

- [ ] **Step 3: Run and commit**

Run: `npx vitest run src/features/salesforce/server/check.test.ts && npx tsc --noEmit`
Expected: PASS.

Commit with the message `feat(salesforce): cached pre-send customer check with hold rule`.

---

### Task 7: Wire the pre-send check into sending

**Files:**
- Modify: `src/features/sequences/server/run-sequence-step.ts` (after the verification gate, before "4. Auto-send gates")
- Modify: `src/app/api/cron/sequence-runner/route.ts` (prefetch before the loop)
- Modify: `src/features/messages/server/process-send-queue.ts` (`sendOne`, after the `cancelReason` block; and a prefetch per org)
- Modify: `src/features/messages/server/send-draft.ts` (after the terminal-status check)
- Modify: `src/features/messages/types.ts` (new errors)
- Modify: `src/app/api/drafts/[id]/send/route.ts` (error mapping)
- Tests: the matching `*.test.ts` files

**Interfaces:**
- Consumes: Task 6 (`ensureSalesforceClear`, `applySalesforceBlock`, `prefetchSalesforceChecks`, `SF_HOLD_MS`).
- Produces:
  - `class LeadBlockedBySalesforceError extends Error { reason: string }`
  - `class SalesforceCheckUnavailableError extends Error`

  Both go in `src/features/messages/types.ts`, following the file's existing error-class pattern.

- [ ] **Step 1: Write the failing tests.** Mock `@/features/salesforce/server/check` in each existing test file:
  - **In `run-sequence-step.test.ts`,** default the mock to return all allowed. Cases:
    - blocked → `applySalesforceBlock(orgId, leadId, reason)` is called and the result is `'STOPPED'`, with no AI call
    - held → the result equals what `defer(enrollmentId, SF_HOLD_MS)` returns: `nextDueAt` is pushed and there's no AI call
    - allowed → unchanged
  - **In `process-send-queue.test.ts`:**
    - blocked → the message is updated to `CANCELLED` with `lastError = reason` and `processing: false`, `applySalesforceBlock` is called with `{ exceptMessageId: messageId }`, the outcome is `cancelled`, and there's no send
    - held → the message is released (`processing: false`, `processingStartedAt: null`, `scheduledFor = now + SF_HOLD_MS`), the outcome is `deferred`, no send happens, and no slot is reserved
  - **In `send-draft.test.ts`:**
    - blocked → `applySalesforceBlock` is called and `LeadBlockedBySalesforceError` is thrown before any send or claim
    - held → `SalesforceCheckUnavailableError` is thrown
  - **In the drafts send `route.test.ts`:**
    - `LeadBlockedBySalesforceError` → 422 `{code:'SALESFORCE_BLOCKED', error: reason}`
    - `SalesforceCheckUnavailableError` → 503 `{code:'SALESFORCE_UNAVAILABLE', error:"Couldn't check Salesforce; try again shortly."}`
  - **In the sequence-runner `route.test.ts`:** `prefetchSalesforceChecks` is called once with the due enrollments' lead ids before processing. A throw from it doesn't stop processing.

- [ ] **Step 2: Implement:**
  - **`run-sequence-step.ts`:**

```ts
    const sf = await ensureSalesforceClear(enrollment.organizationId, [enrollment.lead.id])
    const sfReason = sf.blocked.get(enrollment.lead.id)
    if (sfReason) {
      await applySalesforceBlock(enrollment.organizationId, enrollment.lead.id, sfReason)
      return 'STOPPED'
    }
    if (sf.held.has(enrollment.lead.id)) return defer(enrollmentId, SF_HOLD_MS)
```

  - **`sequence-runner/route.ts`:** change the due-enrollments select to `{ id: true, leadId: true }`, then:

```ts
    try {
      await prefetchSalesforceChecks(dueEnrollments.map((e) => e.leadId))
    } catch (err) {
      console.error('[sequence-runner] salesforce prefetch failed', err)
    }
```

  - **`process-send-queue.ts`:**
    - At the start of each org's loop body, after the mailboxes load, prefetch that org's due QUEUED lead ids (`take: 200`, distinct `leadId`) inside a try/catch.
    - In `sendOne`, after the `cancelReason` block, call `ensureSalesforceClear(message.organizationId, [message.leadId])` and handle blocked and held as the tests require.
  - **`send-draft.ts`:** after the `TERMINAL_STATUSES` check, run the same check and throw the new errors.
  - **Drafts send route:** map the two errors.

- [ ] **Step 3: Run the focused tests and the regression suites**

Run: `npx vitest run src/features/sequences src/features/messages src/app/api/cron src/app/api/drafts && npx tsc --noEmit`
Expected: PASS, including every pre-existing test. With the mock defaulting to all allowed, existing behavior is unchanged.

- [ ] **Step 4: Commit** with the message `feat(salesforce): block or hold sends using the Salesforce check`.

---

### Task 8: List view import (server and routes)

**Files:**
- Create: `src/features/salesforce/server/import-list-view.ts` + `import-list-view.test.ts`
- Create: `src/app/api/salesforce/list-views/route.ts` + `route.test.ts`
- Create: `src/app/api/salesforce/list-views/[id]/preview/route.ts` + `route.test.ts`
- Create: `src/app/api/salesforce/import/route.ts` + `route.test.ts`
- Create: `src/features/salesforce/server/require-connection.ts` (a shared route helper)

**Interfaces:**
- Consumes:
  - Task 4: `getSalesforceClient`
  - Task 5: `fetchPeople`, `classifySfRecord`, `SKIP_KEY`, `BLOCKING`
  - Task 3: `getConnection`, `isSalesforceActive`
  - `normalizeCountry` from `@/features/leads/canada`
  - `scoreLeads` from `@/features/leads/server/score-leads`
- Produces:
  - `MAX_SF_IMPORT = 2000`, `PREVIEW_ROWS = 25`
  - `type SfObjectName = 'Lead' | 'Contact'`
  - `listListViews(orgId, object)`
  - `previewListView({ organizationId, object, listViewId }): Promise<{ total: number; rows: { id: string; name: string; email: string | null; company: string | null; title: string | null }[] }>`
  - `interface SfImportResult { batchId: string; imported: number; linked: number; skipped: { customer: number; openOpportunity: number; optedOut: number; converted: number; noEmail: number; invalid: number }; leadIds: string[] }`
  - `importListView({ organizationId, memberId, object, listViewId, listViewLabel, useSalesforceOwners }): Promise<SfImportResult>`
  - `requireActiveConnection(orgId): Promise<SalesforceConnection | NextResponse>`. This returns a 409 `{code:'NOT_CONNECTED', error:'Connect Salesforce in Settings first.'}` when there's no connection, or `{code:'NOT_CONNECTED', error:'Reconnect Salesforce in Settings.'}` when the status is `NEEDS_RECONNECT`.

**Import algorithm:**
1. Page `client.listViewIds(object, listViewId, {limit: 200, offset})` from offset 0 until the ids reach `size`, `MAX_SF_IMPORT`, or a page comes back empty.
2. `people = fetchPeople(client, object, { ids })`.
3. For each person:
   - no email → `noEmail++`
   - `z.string().email()` fails → `invalid++`
   - `check = classifySfRecord(p, conn rules)`; a blocking status → `skipped[SKIP_KEY[status]]++` and remember it for existing leads
4. Load the existing leads: `lead.findMany({ where: { organizationId, email: { in: emails } } })`.
5. **Existing leads** (both blocked and clear) are updated:
   - set the link when `salesforceId` is null
   - fill only null fields among `firstName, lastName, company, title, phone, country`
   - merge `customFields` keys `state`/`zip` only when absent
   - set `sfCheckStatus`, `sfCheckDetail` and `sfCheckedAt: now`
   - count as `linked` only when not blocked
6. **New clear leads:**
   - `prisma.importBatch.create({ fileName: 'Salesforce: ' + listViewLabel, rowCount: people.length, status: 'PROCESSING' })`
   - then `prisma.lead.createManyAndReturn({ data, skipDuplicates: true, select: { id: true } })`, where each lead has:
     - `source: 'SALESFORCE'`, `importBatchId`, `ownerId`
     - `country: normalizeCountry(p.country)`
     - `customFields: { state, zip }`, omitting null keys and the whole object when it's empty
     - the link fields: `salesforceType: p.type`
     - `sfCheckStatus: 'CLEAR'`, `sfCheckedAt: now`
7. **Owner:**
   - `memberId` by default.
   - When `useSalesforceOwners`, load `orgMember.findMany({ where: { organizationId } , select: { id, email } })`. If `p.ownerEmail` matches a member's email (case-insensitive), that member is the owner.
8. Update the batch to `{ successCount: imported + linked, errorCount: sum(skipped), status: 'COMPLETED' }`.
9. Return the result, with `leadIds` = the new ids.

**Routes** (use `resolveMember`; null → 401 `{error:'Unauthorized'}`):
- **`GET /api/salesforce/list-views?object=Lead|Contact`:**
  - `object` must be `Lead` or `Contact` → else 400
  - `requireActiveConnection`
  - returns `{ listViews }`
- **`GET /api/salesforce/list-views/[id]/preview?object=`:** returns `previewListView`. The name is `firstName lastName`, or the email.
- **`POST /api/salesforce/import`:**
  - body zod: `{ object: z.enum(['Lead','Contact']), listViewId: z.string().min(1), listViewLabel: z.string().min(1).max(200), useSalesforceOwners: z.boolean().optional() }` → 400 on failure
  - `useSalesforceOwners` only when `ctx.isAdmin`, otherwise false
  - after import, `scoreLeads({ organizationId, leadIds })` in a try/catch; on failure add `scoringError`, matching `src/app/api/leads/import/route.ts`
  - returns 201 with the result
  - `export const maxDuration = 60`
- **Error mapping** for all three routes:
  - `SalesforceAuthError` → 409 NOT_CONNECTED "Reconnect Salesforce in Settings."
  - `SalesforceRateLimitError` → 429 `{code:'RATE_LIMITED', error:'Salesforce API limit reached for today.'}`
  - `SalesforceApiError` → 502 `{code:'SALESFORCE_ERROR', error: err.message}`

- [ ] **Step 1: Write the failing `import-list-view.test.ts`** with a fake client and mocked prisma. Cases:
  - Paging stops at `size` (a 450-row size fetches offsets 0/200/400) and at `MAX_SF_IMPORT` (a size of 5000 fetches offsets 0..1800 only).
  - Mapping (Lead and Contact):
    - `company` comes from the Account name for a Contact
    - `customFields: { state: 'NY', zip: '14206' }`
    - `country` is normalized (`'United States'` → whatever `normalizeCountry` returns)
  - Skip counting: `{customer:1, openOpportunity:1, optedOut:1, converted:1, noEmail:1, invalid:1}` from six crafted people.
  - An existing lead is linked, not recreated. Its `firstName` isn't overwritten when set and is filled when null, and it counts as `linked`.
  - Re-import (Review Focus 4): with every email already existing → `imported: 0`, `linked: n`, and `createManyAndReturn` gets an empty `data` (or isn't called).
  - Owners:
    - by default, `ownerId = memberId`
    - `useSalesforceOwners` with a matching `Owner.Email` → that member
    - no match → `memberId`
  - Batch: `fileName` is `'Salesforce: My NY PMs'`, and it ends `COMPLETED` with the counts.
- [ ] **Step 2: Implement `import-list-view.ts` and `require-connection.ts`.**
- [ ] **Step 3: Write the failing route tests:**
  - 401 without a member
  - 400 on a bad `object` or body
  - 409 when not connected, and when `NEEDS_RECONNECT`
  - a member's `useSalesforceOwners: true` is passed as false; an admin's is passed as true
  - `scoreLeads` is called with `leadIds`; a scoring failure still returns 201 with `scoringError`
  - the three error mappings
- [ ] **Step 4: Implement the routes.**
- [ ] **Step 5: Run and commit**

Run: `npx vitest run src/features/salesforce src/app/api/salesforce && npx tsc --noEmit`
Expected: PASS.

Commit with the message `feat(salesforce): import Lead and Contact list views`.

---

### Task 9: Import UI on the Leads page

**Files:**
- Create: `src/features/salesforce/components/salesforce-import-dialog.tsx` + `salesforce-import-dialog.test.tsx`
- Modify: `src/app/(dashboard)/leads/page.tsx` (pass `salesforceConnected` and `isAdmin`)
- Modify: `src/app/(dashboard)/leads/leads-client.tsx` (render the button and the dialog next to `CsvUploadForm`; on success call the same refresh path `handleImportSuccess` uses, e.g. `router.refresh()`)

**Interfaces:**
- Consumes: the Task 8 routes and response shapes.
- Produces: `SalesforceImportDialog({ isAdmin, onImported }: { isAdmin: boolean; onImported: () => void })`.

**Behavior:**
- **Trigger:** an "Import from Salesforce" button (`@/components/ui/button`, secondary style) opens an inline panel, in the same visual style as `csv-upload-form.tsx`. Match its Tailwind CSS-variable classes.
- **Object:** a "Record type" select with Leads / Contacts. Changing it fetches `/api/salesforce/list-views?object=`.
- **List view:**
  - a "List view" select, labelled `<label htmlFor>`, with the placeholder "Choose a list view"
  - on change it fetches the preview and shows "N records in this view" and a table of up to 25 rows (Name, Email, Company, Title)
  - when the total is over 2000: "Only the first 2,000 will be imported."
- **Owners:** admin-only checkbox "Use Salesforce owners where they match a rep".
- **Import:**
  - the "Import" button is disabled while busy or with no list view chosen
  - it POSTs `{object, listViewId, listViewLabel, useSalesforceOwners}`
  - on success: "Imported X new leads, linked Y existing."
  - if anything was skipped, add a second line listing only the non-zero reasons in the order customer, openOpportunity, optedOut, converted, noEmail, invalid. Labels: "customers", "open opportunities", "opted out", "converted leads", "no email", "invalid email". Example: "12 skipped: 8 customers, 3 opted out, 1 no email".
  - then call `onImported()`
- **Errors:** any error shows the server's `error` in `role="alert"`. Use try/catch/finally, and reset busy in finally.

- [ ] **Step 1: Write the failing component tests** (mock `fetch`):
  - renders the labelled controls
  - loads list views for the Leads object on open
  - selecting a view shows the preview count and rows
  - the admin checkbox is only shown for admins
  - Import posts the right body and shows the success and skip lines exactly (e.g. `'12 skipped: 8 customers, 3 opted out, 1 no email'`)
  - a 409 error text is shown in an alert
  - the Import button is disabled before a view is chosen
- [ ] **Step 2: Implement the component, and wire it into the page and the client.** The page computes `salesforceConnected = !!(await getConnection(org.id)) && status !== 'NEEDS_RECONNECT'`, and the button renders only then.
- [ ] **Step 3: Run and commit**

Run: `npx vitest run src/features/salesforce/components && npx tsc --noEmit && npx eslint src/features/salesforce "src/app/(dashboard)/leads"`
Expected: PASS.

Commit with the message `feat(salesforce): import from Salesforce on the Leads page`.

---

### Task 10: Activity logging queue (enqueue, processor, cron and retry)

**Files:**
- Create: `src/features/salesforce/server/enqueue.ts` + `enqueue.test.ts`
- Create: `src/features/salesforce/server/process-jobs.ts` + `process-jobs.test.ts`
- Modify: `src/features/messages/server/process-send-queue.ts` (`finalizeSent`, after persisted)
- Modify: `src/features/messages/server/send-draft.ts`: after each place an OutboundMessage becomes `SENT`. Today these are around lines 138, 391 and 507; locate them by `status: 'SENT'`.
- Modify: `src/features/replies/server/record-reply.ts` (after `inboundReply.create`)
- Modify: `src/app/api/cron/sequence-runner/route.ts` (run jobs after the step loop)
- Create: `src/app/api/salesforce/jobs/[id]/retry/route.ts` + `route.test.ts`

**Interfaces:**
- Consumes:
  - Task 3: `getConnection`, `isSalesforceActive`, `releaseExpiredRateLimits`, `CLEARED_LEAD_LINK`
  - Task 4: `getSalesforceClient`, `resolveSfUserId`
  - Task 5: `fetchPeople`
  - the error classes
- Produces:
  - `enqueueSendLog(organizationId, leadId, outboundMessageId): Promise<void>`
  - `enqueueReplyLog(organizationId, leadId, inboundReplyId): Promise<void>`

    Neither ever throws. They catch errors and log them with `console.error`.
  - `BACKOFF_MS = [5*60e3, 30*60e3, 2*3600e3, 12*3600e3, 12*3600e3]`, `MAX_ATTEMPTS = 6`
  - `processSalesforceJobs(opts?: { limit?: number; now?: Date; budgetMs?: number }): Promise<{ done: number; failed: number; retried: number; skippedOrgs: number }>`

**Enqueue rules:**
- Do nothing when there's no connection or `logActivity` is false.
- **Send:** only when the lead has a `salesforceId`. `salesforceSyncJob.createMany({ data: [{ organizationId, leadId, type: 'LOG_SEND', outboundMessageId }], skipDuplicates: true })`.
- **Reply:** `type = lead.salesforceId ? 'LOG_REPLY' : 'CREATE_LEAD'`, with `inboundReplyId`.

**Processor:**
1. `releaseExpiredRateLimits(now)`.
2. Load up to `limit` (default 50) jobs:

```ts
where: {
  status: 'PENDING',
  nextAttemptAt: { lte: now },
  organization: { salesforceConnection: { is: { status: 'CONNECTED' } } },
}
```

   `orderBy createdAt asc`, including the lead (`id, organizationId, email, firstName, lastName, company, title, phone, ownerId, salesforceId, salesforceType`), the `outboundMessage` (`subject, body, sentAt`) and the `inboundReply` (`subject, rawBody, receivedAt, createdAt`).
3. Group the jobs by org, and keep one client per org. Stop when the budget (default 8,000 ms) is spent.
4. **`LOG_SEND` / `LOG_REPLY`:**
   - Re-read the lead's link from the DB (Review Focus 6). If there's no `salesforceId`, mark `FAILED` with `'Lead is not linked to Salesforce'`.
   - Otherwise `client.create('Task', {...})` with:
     - `WhoId: salesforceId`
     - `Subject: truncate(`${type === 'LOG_SEND' ? 'Email' : 'Reply'}: ${subject ?? '(no subject)'}`, 255)`
     - `Description: truncate(body, 32000)`
     - `Status: 'Completed'`, `Priority: 'Normal'`, `TaskSubtype: 'Email'`
     - `ActivityDate: (sentAt ?? receivedAt ?? createdAt).toISOString().slice(0, 10)`
     - `OwnerId: await resolveSfUserId(client, orgId, lead.ownerId)`
   - Then `DONE` with `sfTaskId`.
5. **`CREATE_LEAD`:**
   - Re-read the lead. If it's now linked, just enqueue the history. Otherwise:
     - `contacts = fetchPeople(client, 'Contact', {emails: [email]})`
     - `leads = fetchPeople(client, 'Lead', {emails:[email]}).filter(l => !l.isConverted)`
     - `match = contacts[0] ?? leads[0]`
     - If there's no match, `client.create('Lead', {...})` with:
       - `FirstName`
       - `LastName: lastName ?? email.split('@')[0]`
       - `Company: company ?? 'Unknown'`
       - `Email`, `Title`, `Phone`
       - `LeadSource: 'OutboundOS'`
       - `OwnerId: resolveSfUserId(...)`
   - Link the lead with `lead.updateMany({ where: { id, salesforceId: null }, data: { salesforceId, salesforceType, salesforceAccountId } })`.
   - Enqueue the history:
     - `LOG_SEND` for every SENT OutboundMessage of the lead
     - `LOG_REPLY` for every InboundReply of the lead, including the triggering one

     Use `createMany skipDuplicates`.
   - Mark the job `DONE`.
6. **Errors:**
   - `SalesforceAuthError` / `SalesforceRateLimitError`: leave the job PENDING without consuming an attempt, skip the rest of that org's jobs, and count it in `skippedOrgs`.
   - `SalesforceApiError` with `errorCode` in `ENTITY_IS_DELETED`, `INVALID_CROSS_REFERENCE_KEY` or `NOT_FOUND` on a Task create:
     - clear the lead's link (`CLEARED_LEAD_LINK`, keeping the `sfCheck*` fields: clear only `salesforceId/Type/AccountId`)
     - a `LOG_REPLY` job becomes `CREATE_LEAD` with `attempts: 0`, `nextAttemptAt: now`
     - a `LOG_SEND` job becomes `FAILED` with `lastError`
   - Any other error: `attempts + 1`. When it reaches `MAX_ATTEMPTS` → `FAILED`. Otherwise `nextAttemptAt = now + BACKOFF_MS[attempts - 1]`. Set `lastError = '<errorCode>: <message>'` for `SalesforceApiError`, else `err.message`.

**Cron:** in the `sequence-runner` route, after the step loop and inside the outer try:

```ts
if (Date.now() - startedAt < SEQUENCE_RUNNER_BUDGET_MS) {
  try {
    salesforce = await processSalesforceJobs({ budgetMs: 5_000 })
  } catch (err) {
    salesforce = { error: String(err) }
  }
}
```

Include `salesforce` in the JSON response.

**Retry route:** `POST /api/salesforce/jobs/[id]/retry`, admin-only.
- `updateMany({ where: { id, organizationId: ctx.org.id, status: 'FAILED' }, data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } })`
- `count === 0` → 404 `{error:'Job not found.'}`; otherwise `{ok:true}`

- [ ] **Step 1: Write the failing `enqueue.test.ts`:**
  - no connection → no `createMany`
  - `logActivity: false` → none
  - a send for an unlinked lead → none
  - a send for a linked lead → `LOG_SEND` with `skipDuplicates: true`
  - a reply for an unlinked lead → `CREATE_LEAD`; a reply for a linked lead → `LOG_REPLY`
  - a prisma error is swallowed
- [ ] **Step 2: Implement `enqueue.ts`.** Add the calls:
  - `process-send-queue.ts` `finalizeSent`: `await enqueueSendLog(organizationId, leadId, messageId)` after the SENT update persisted
  - `send-draft.ts`: after each SENT transition, with the finalized message id
  - `record-reply.ts`: `await enqueueReplyLog(input.organizationId, input.leadId, reply.id)` after the create

  Add one test to each touched existing test file asserting the call. Mock `@/features/salesforce/server/enqueue` there.
- [ ] **Step 3: Write the failing `process-jobs.test.ts`:**
  - `LOG_SEND` creates a Task with exactly the fields above, including the 255 and 32,000 truncation and `ActivityDate` as a date-only string, and marks it `DONE` with `sfTaskId`
  - `LOG_REPLY` uses `Reply:` and the reply body
  - `CREATE_LEAD`:
    - an existing Contact is found → linked and no `create('Lead')`
    - none found → `create('Lead')` with the `'Unknown'` and local-part fallbacks and `LeadSource: 'OutboundOS'`, then history enqueued for 2 sends and 1 reply
  - Review Focus 6: two `CREATE_LEAD` jobs for the same lead in one run → the second finds the lead linked (re-read) and does not call `create('Lead')`
  - an auth error leaves the job PENDING with attempts unchanged, and the org's remaining jobs are untouched
  - a generic error with attempts 0 → `attempts: 1`, `nextAttemptAt: now + 5min`; attempts 5 → `FAILED`
  - `ENTITY_IS_DELETED` on `LOG_REPLY` → the link is cleared and the job becomes `CREATE_LEAD`
  - the budget stops processing
  - `releaseExpiredRateLimits` is called first
- [ ] **Step 4: Implement `process-jobs.ts`, the cron wiring, and the retry route with its tests** (403 for a member, 404 when not found, 200 on success).
- [ ] **Step 5: Run and commit**

Run: `npx vitest run src/features/salesforce src/features/messages src/features/replies src/app/api/cron src/app/api/salesforce && npx tsc --noEmit`
Expected: PASS.

Commit with the message `feat(salesforce): log sends and replies as Salesforce Tasks via a sync queue`.

---

### Task 11: Settings (status, rules, health) and the Salesforce card

**Files:**
- Create: `src/features/salesforce/server/settings.ts` + `settings.test.ts`
- Create: `src/app/api/integrations/salesforce/settings/route.ts` (PATCH) + `route.test.ts`
- Create: `src/features/salesforce/components/salesforce-card.tsx` + `salesforce-card.test.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx` and `settings-client.tsx`. Render the card for everyone. Admins get controls; members get the status only. Put it right after `MicrosoftCard` for admins, and in the member view near the top.

**Interfaces:**
- Consumes: Task 3 (`getConnection`), `getSalesforceAppConfig`, and the Prisma models.
- Produces:
  - `interface SalesforceStatusDTO { configured: boolean; connected: boolean; status: 'CONNECTED' | 'NEEDS_RECONNECT' | 'RATE_LIMITED' | null; username: string | null; instanceUrl: string | null; lastError: string | null; rateLimitedUntil: string | null; customerAccountTypes: string[]; blockOpenOpportunities: boolean; logActivity: boolean; counts: { synced24h: number; pending: number; failed: number }; recentFailures: { id: string; type: string; leadEmail: string; lastError: string | null; updatedAt: string }[] }`
  - `getSalesforceStatus(orgId): Promise<SalesforceStatusDTO>`
  - `updateSalesforceSettings(orgId, patch: { customerAccountTypes?: string[]; blockOpenOpportunities?: boolean; logActivity?: boolean }): Promise<boolean>` (false when not connected)

**Details:**
- **`counts`:**
  - `synced24h` = jobs `DONE` with `updatedAt >= now - 24h`
  - `pending` = `PENDING`
  - `failed` = `FAILED`
- **`recentFailures`:** the last 10 `FAILED` jobs by `updatedAt desc`, with the lead's email.
- **When not connected:** zero counts, empty failures, and the defaults `['Customer']`, true, true.
- **PATCH validation (zod):**
  - `customerAccountTypes: z.array(z.string().trim().min(1).max(80)).max(20).optional()`
  - the two booleans are optional
  - the object must have at least one key → else 400
  - admin-only
  - 409 `NOT_CONNECTED` when `updateSalesforceSettings` returns false
- **Card copy** (plain, no em dashes):
  - **Not configured:** "Salesforce isn't configured on this server."
  - **Not connected (admin):**
    - an environment radio, "Production" / "Sandbox"
    - a "Connect Salesforce" link button to `/api/integrations/salesforce/connect?env=<env>`
    - help text: "Connect with a Salesforce user that has API access. A dedicated integration user works best. If you're not sure, ask your Salesforce admin which edition you have and to allow the OutboundOS app."
  - **Connected:**
    - "Connected as <username>" plus a `Badge` for the status
    - a Disconnect button: confirm "Disconnect Salesforce? Syncing stops; records already in Salesforce stay.", then DELETE `/api/integrations/salesforce` and `router.refresh()`
  - **Rules form (admin):**
    - "Account types that count as customers" text input, comma-separated
    - "Don't email contacts whose account has an open opportunity" checkbox
    - "Log emails and replies to Salesforce" checkbox
    - a Save button that PATCHes and shows "Saved."
  - **Health:** "Last 24 hours: X synced, Y pending, Z failed". A failures list shows the lead email, a readable type (`LOG_SEND` "Email", `LOG_REPLY` "Reply", `CREATE_LEAD` "New lead"), the error, and a Retry button (admin) that POSTs to the retry route and refreshes.
  - **Banners:**
    - `NEEDS_RECONNECT`: "Salesforce needs to be reconnected. Activity logging and customer checks are paused." plus a Reconnect button (admin)
    - `RATE_LIMITED`: "Salesforce's daily API limit is nearly used up. Salesforce work resumes at <local time of rateLimitedUntil>."
  - **Query-param messages** (read with `useSearchParams`, like `MicrosoftCard`), keyed on `?salesforce=`:
    - `connected`: "Salesforce connected."
    - `connected_new_org`: "Salesforce connected. This is a different Salesforce org than before, so existing lead links were cleared."
    - `error` with `reason=`:
      - `denied`: "Salesforce access wasn't approved."
      - `not_admin`: "Only an admin can connect Salesforce."
      - `state` / `pkce`: "The connection expired. Try again."
      - `not_configured`: "Salesforce isn't configured on this server."
      - `exchange` or anything else: "Something went wrong connecting to Salesforce."
  - **Members:** status line and health counts only. No buttons, form or retry.

- [ ] **Step 1: Write the failing `settings.test.ts`:** the counts and failures query shapes; not-connected defaults; `updateSalesforceSettings` returns false with no row and updates only the given keys.
- [ ] **Step 2: Implement `settings.ts`. Then write the PATCH route test** (403 for a member, 400 for an empty or invalid body, 409 when not connected, 200) and implement the route.
- [ ] **Step 3: Write the failing card tests:**
  - not configured
  - admin not connected: the connect link href includes `env=production`, and switching to Sandbox changes it to `env=sandbox`
  - connected admin: the username, the Save PATCH body `customerAccountTypes: ['Customer','Key Account']` from the input `"Customer, Key Account"`, disconnect confirm, and Retry calls
  - `NEEDS_RECONNECT` banner
  - `connected_new_org` message
  - a member sees counts but no buttons
- [ ] **Step 4: Implement the card and wire it into the settings page.** Call `getSalesforceStatus(org.id)` for everyone.
- [ ] **Step 5: Run and commit**

Run: `npx vitest run src/features/salesforce "src/app/api/integrations/salesforce" && npx tsc --noEmit && npx eslint src/features/salesforce "src/app/(dashboard)/settings"`
Expected: PASS.

Commit with the message `feat(salesforce): settings card with rules, health and reconnect`.

---

### Task 12: Lead page badge and block override

**Files:**
- Modify: `src/features/leads/server/get-lead.ts` and its `LeadDetailDTO` in `src/features/leads/types.ts`. Add `salesforce: { id: string | null; type: 'LEAD' | 'CONTACT' | null; checkStatus: SfCheckStatus | null; checkDetail: string | null; checkedAt: string | null; blockOverride: boolean }`.
- Create: `src/features/salesforce/components/salesforce-badge.tsx` + `salesforce-badge.test.tsx`
- Modify: `src/features/leads/components/lead-header.tsx`. Render `SalesforceBadge` when `salesforceInstanceUrl` is non-null. Add the props `salesforceInstanceUrl: string | null` and pass `isAdmin` through.
- Modify: `src/app/(dashboard)/leads/[leadId]/page.tsx`. Load `getConnection(org.id)` and pass `instanceUrl`, or null when not connected.
- Create: `src/app/api/leads/[id]/salesforce-override/route.ts` + `route.test.ts`

**Interfaces:**
- Consumes: Task 1 fields, Task 3 `getConnection`, Task 5 `BLOCKING`/`blockReason`.
- Produces: `SalesforceBadge({ instanceUrl, leadId, salesforce, isAdmin })`.

**Badge behavior:**
- **Linked:** a "View in Salesforce" link to `${instanceUrl}/${id}`, opening in a new tab with `rel="noopener noreferrer"`.
- **Check status:** a line such as "Salesforce check: clear (checked 3h ago)". Not checked yet: "Salesforce check: not checked yet".
- **Blocking status without an override:**
  - a warning line with `blockReason(status, detail)` plus " Emails to this lead are blocked."
  - admins also see an "Allow anyway" button that POSTs to the override route, then `router.refresh()`
- **Override set:** "Allowed by an admin despite Salesforce. Re-enroll the lead to resume emailing."

**Override route:** `POST /api/leads/[id]/salesforce-override`.
- no member → 401; non-admin → 403 ADMIN_ONLY
- `lead.updateMany({ where: { id, organizationId }, data: { sfBlockOverride: true, sfHeldSince: null } })`, with `count === 0` → 404
- writes an `auditLog` row: action `lead.salesforce_override`, entityType `'Lead'`, entityId, `actorClerkId: ctx.member.clerkUserId`, metadata `{ checkStatus }` read before the update
- returns 200 `{ok:true}`

- [ ] **Step 1: Write the failing tests:**
  - the `get-lead` DTO includes the salesforce block, with ISO strings
  - badge states: linked, not checked, clear, blocked (admin and member), override
  - the override route: 401, 403, 404 and 200 with the audit row
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Run and commit**

Run: `npx vitest run src/features/leads src/features/salesforce src/app/api/leads && npx tsc --noEmit`
Expected: PASS.

Commit with the message `feat(salesforce): lead page link, check status and admin override`.

---

### Task 13: Docs, route inventory and full verification

**Files:**
- Modify: `README.md` (a new `## Salesforce` section after `## Team & rep ownership`)
- Modify: `.env.example` if present (confirm Task 2 added the vars)

**README content:**
- **Setup, once per deployment:**
  1. In a Salesforce org you control, go to Setup → External Client App Manager → New.
  2. Enable OAuth with scopes `api`, `refresh_token` and `id`.
  3. Set the callback to `https://<your-app>/api/integrations/salesforce/callback`.
  4. Require PKCE.
  5. Set `SALESFORCE_CLIENT_ID` and `SALESFORCE_CLIENT_SECRET` in Vercel.
  6. Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32`.
- **Connecting:**
  - an admin uses Settings → Salesforce → Connect
  - use a user with API access, ideally an integration user
  - questions for IT: the edition (Enterprise or Unlimited include API access; Professional may need the API add-on), and approving the app
- **Importing:**
  - Leads page → Import from Salesforce
  - up to 2,000 records per import
  - what's skipped and why
  - re-running only adds new records
- **Activity logging:**
  - sends and replies become completed Tasks
  - unknown prospects become Salesforce Leads when they reply
  - the retry schedule
  - where failures show
- **Customer check:**
  - the four rules and the settings for them
  - the 24h cache
  - the hold rule (7 days, then held, and an alert after 24h)
  - the admin "Allow anyway" override
- **Limits:** the 80% API usage pause.

- [ ] **Step 1: Write the README section.**
- [ ] **Step 2: Run the full verification**

Run: `npx vitest run`
Expected: all test files pass. Record the counts.

Run: `npx tsc --noEmit && npx eslint .`
Expected: clean.

- [ ] **Step 3: Commit** with the message `docs: Salesforce setup and behavior`.
