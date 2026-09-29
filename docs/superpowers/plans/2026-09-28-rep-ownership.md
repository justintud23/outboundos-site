# Rep Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Campaigns, leads and mailboxes are owned by reps. Reps send as themselves, reply alerts route to the owner, and "Mine / Team" views are added. Admins can do everything; reps can act only on what they own.

**Architecture:**
- **Member records:** a local `OrgMember` row per signed-in user, synced from Clerk by `resolveMember()`, replaces `resolveOrganization()` in signed-in routes and pages.
- **Permission checks:** a pure `canAct(ctx, ownerId)`, org-scoped owner lookups, and one 403 response helper guard every write route.
- **Ownership fields:** nullable `ownerId` on Campaign, Lead and Mailbox.
- **Mailbox choice** narrows to the owner's mailboxes.
- **Sender merge fields** come from the campaign owner.
- **Reply alerts** resolve the recipient through the lead owner, then the mailbox owner, then the org.
- **List functions** take an optional `ownerId` filter, driven by a `?view=` toggle.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript strict (`noUncheckedIndexedAccess`), Prisma 7 + Neon Postgres, Clerk (`@clerk/nextjs` v7: `auth()` returns `orgId`, `userId`, `orgRole`; `await clerkClient()`), Microsoft Graph, Vitest + Testing Library, Tailwind v4 CSS variables.

**Spec:** `docs/superpowers/specs/2026-09-28-rep-ownership-design.md`

## Global Constraints

- **Roles:** `orgRole === 'org:admin'` → `role = 'admin'`; anything else → `'member'`. `isAdmin = role === 'admin'`.
- **canAct:** admins → true; members → `ownerId !== null && ownerId === member.id`. Unassigned (`null`) is admin-only for writes.
- **Permission failures:**
  - non-owner → **403 `{ code: 'NOT_OWNER', error: 'You can only change your own campaigns and leads.' }`**
  - non-admin on an admin action → **403 `{ code: 'ADMIN_ONLY', error: 'Only an admin can do this.' }`**
- **Missing entity:** an owner lookup returns `undefined` when the entity doesn't exist in this org. The route then falls through to its existing 404 path, so it never leaks existence.
- **Clerk refresh:** at most once per hour per member (`lastSeenAt`). A Clerk failure is logged and tolerated. Background jobs never call Clerk.
- **Mailbox choice:**
  - **Campaign owner owns at least one mailbox (any state):** only that owner's mailboxes. If none is usable → `null` (defer).
  - **Owner owns none, or the campaign has no owner:** shared mailboxes (`ownerId: null`).
  - Pinned enrollments are untouched.
  - Manual-send rotation applies the same rule keyed on the lead owner.
- **Alert recipients:**
  - **to** = lead owner's `escalationEmail ?? email` → mailbox owner's → `Organization.escalationEmail`
  - **cc** = `Organization.escalationEmail` when `copyAdminOnReplies` is on and it differs (case-insensitively) from `to`
  - `sendOrgAlert` is unchanged (org address only)
- **Sender merge fields:** `senderFirstName` and `senderName` (first + " " + last, trimmed) come from the campaign owner. A real `customFields` key with the same name wins.
- **Starter templates:** each step's closing line is `Thanks,\n{senderFirstName|}`.
- **Views:** `?view=mine|team`; default `mine` for members, `team` for admins. The toggle remembers the last choice in `localStorage` key `outboundos:view` (try/catch).
- **Git and secrets:**
  - Commit on branch `feat/rep-ownership`; never push; never print `.env`.
  - Every commit message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A rep calling a write API directly** (bypassing the hidden button) on another rep's campaign, sequence, variant, enrollment, draft, lead or message must get 403, and nothing may be written. There's a table-driven test per route family (Tasks 3–5).
2. **An owner who has mailboxes, but all of them are paused or on failing domains.** The enrollment must defer, not silently send from a shared or other rep's mailbox (Task 6 test).
3. **A rep with no escalation email set and no login email** (e.g. a Clerk user with only a phone number). The alert must fall back to the mailbox owner, then the org, and never throw (Task 8 test).
4. **An org before anyone assigns anything:** every mailbox unowned, every campaign unowned. Mailbox choice, sending and alerts must behave exactly as before (Tasks 6 and 8 tests).
5. **A member without admin who opens Settings or calls a settings/mailbox/deliverability route.** The route returns 403 `ADMIN_ONLY`, and the page shows read-only or hidden controls rather than a crash (Tasks 5 and 12 tests).

---

## Write-route inventory (every mutating route and its rule)

| Route | Method | Rule | Task |
|---|---|---|---|
| `/api/campaigns` | POST | any member; sets `ownerId = member.id` | 3 |
| `/api/campaigns/[id]` | PATCH | canAct(campaign owner) | 3 |
| `/api/campaigns/[id]/approve-sample` | POST | canAct(campaign owner) | 3 |
| `/api/campaigns/[id]/content-override` | POST | canAct(campaign owner) | 3 |
| `/api/campaigns/[id]/placement-test` | POST | canAct(campaign owner) | 3 |
| `/api/sequences` | POST | canAct(owner of `body.campaignId`) | 4 |
| `/api/sequences/[id]` | PATCH | canAct(sequence's campaign owner) | 4 |
| `/api/sequences/[id]/enroll` | POST | canAct(sequence's campaign owner) | 4 |
| `/api/sequences/enrollments/[id]` | PATCH | canAct(enrollment's campaign owner) | 4 |
| `/api/sequences/steps/[stepId]/variants` | POST | canAct(step's campaign owner) | 4 |
| `/api/sequences/steps/[stepId]/winner` | POST | canAct(step's campaign owner) | 4 |
| `/api/sequences/variants/[variantId]` | PATCH, DELETE | canAct(variant's campaign owner) | 4 |
| `/api/drafts/[id]/review` | PATCH | canAct(draft owner) | 5 |
| `/api/drafts/[id]/send` | POST | canAct(draft owner) | 5 |
| `/api/drafts/generate` | POST | canAct(owner of `body.leadId`) | 5 |
| `/api/leads/[id]/status` | PATCH | canAct(lead owner) | 5 |
| `/api/messages/[id]/retry` | POST | canAct(message's lead owner) | 5 |
| `/api/leads/import` | POST | any member | — (unchanged) |
| `/api/inbox/[leadId]/read` | PATCH | any member | — (unchanged) |
| `/api/replies` | POST | any member | — (unchanged) |
| `/api/settings/sending` | PATCH | admin | 5 |
| `/api/settings/business-profile` | PUT | admin | 5 |
| `/api/settings/business-profile/rescore` | POST | admin | 5 |
| `/api/mailboxes` | POST | admin | 5 |
| `/api/mailboxes/[id]` | PATCH | admin | 5 |
| `/api/integrations/microsoft/mailboxes` | POST | admin | 5 |
| `/api/deliverability/domains/[id]` | PATCH | admin | 5 |
| `/api/deliverability/domains/[id]/recheck` | POST | admin | 5 |
| `/api/templates` | POST | admin | 5 |
| `/api/templates/[id]` | PATCH | admin | 5 |
| `/api/campaigns/[id]/owner`, `/api/leads/[id]/owner` | PATCH | admin (new) | 11 |
| `/api/team/members/[id]` | PATCH | admin, or self (new) | 12 |
| `/api/team/settings` | PATCH | admin (new) | 12 |
| `/api/integrations/microsoft/connect` | GET | admin | final fix |
| `/api/integrations/microsoft/callback` | GET | admin | final fix |
| `/api/unsubscribe`, `/api/webhooks/sendgrid`, `/api/cron/*` | — | not user-authenticated; unchanged | — |

"Draft owner" = the draft's campaign owner when it has a campaign; otherwise the draft's lead owner.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260929000000_rep_ownership/migration.sql`

**Interfaces:**
- Produces:
  - `OrgMember` gains `name String?`, `email String?`, `escalationEmail String?`, `senderFirstName String?`, `senderLastName String?`, `lastSeenAt DateTime?`, plus relations `ownedCampaigns Campaign[] @relation("CampaignOwner")`, `ownedLeads Lead[] @relation("LeadOwner")` and `ownedMailboxes Mailbox[] @relation("MailboxOwner")`
  - `Campaign.ownerId`, `Lead.ownerId`, `Mailbox.ownerId`, each `String?` with `onDelete: SetNull`, and relation fields `owner OrgMember?`
  - `Organization.copyAdminOnReplies Boolean @default(true)` and `Organization.ownershipBannerDismissedAt DateTime?`

- [ ] **Step 1: Edit the schema**

In `model OrgMember`, add after `role`:

```prisma
  name            String?
  email           String?
  // Where this rep's reply alerts go; null → email.
  escalationEmail String?
  senderFirstName String?
  senderLastName  String?
  lastSeenAt      DateTime?

  ownedCampaigns Campaign[] @relation("CampaignOwner")
  ownedLeads     Lead[]     @relation("LeadOwner")
  ownedMailboxes Mailbox[]  @relation("MailboxOwner")
```

In `model Campaign`, `model Lead` and `model Mailbox`, add:

```prisma
  ownerId String?
  owner   OrgMember? @relation("CampaignOwner", fields: [ownerId], references: [id], onDelete: SetNull)
```

Use relation name `"LeadOwner"` for Lead and `"MailboxOwner"` for Mailbox. Add the indexes:
- Campaign: `@@index([ownerId])`
- Lead: `@@index([organizationId, ownerId])`
- Mailbox: `@@index([ownerId])`

In `model Organization`, after `allowCanadianRecipients`, add:

```prisma
  // Rep ownership: CC the org escalation address on reps' reply alerts.
  copyAdminOnReplies         Boolean   @default(true)
  ownershipBannerDismissedAt DateTime?
```

- [ ] **Step 2: Generate the migration SQL**

Run `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script > /tmp/rep.sql` if DB access works, and save the output as `prisma/migrations/20260929000000_rep_ownership/migration.sql`. Otherwise, hand-write the equivalent SQL:
- `ALTER TABLE "org_members" ADD COLUMN …` for each new column
- `ALTER TABLE "campaigns"/"leads"/"mailboxes" ADD COLUMN "ownerId" TEXT`
- the three FK constraints `… REFERENCES "org_members"("id") ON DELETE SET NULL ON UPDATE CASCADE`
- the indexes `campaigns_ownerId_idx`, `leads_organizationId_ownerId_idx`, `mailboxes_ownerId_idx`
- `ALTER TABLE "organizations" ADD COLUMN "copyAdminOnReplies" BOOLEAN NOT NULL DEFAULT true, ADD COLUMN "ownershipBannerDismissedAt" TIMESTAMP(3)`

The controller applies it to the dev DB and runs the drift check.

- [ ] **Step 3: Validate and generate**

Run: `npx prisma validate && npx prisma generate && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260929000000_rep_ownership
git commit -m "feat(team): schema for rep ownership"
```

---

### Task 2: Member resolution and permissions

**Files:**
- Create: `src/lib/auth/resolve-member.ts`
- Test: `src/lib/auth/resolve-member.test.ts`
- Create: `src/features/team/permissions.ts`
- Test: `src/features/team/permissions.test.ts`
- Create: `src/features/team/server/owners.ts`
- Test: `src/features/team/server/owners.test.ts`
- Create: `src/lib/auth/permission-response.ts`

**Interfaces:**
- Produces:
  - `interface MemberContext { org: Organization; member: OrgMember; isAdmin: boolean }`
  - `resolveMember(): Promise<MemberContext | null>` (null when there's no org or user)
  - `canAct(ctx: { isAdmin: boolean; member: { id: string } }, ownerId: string | null): boolean`
  - `assertCanAct(ctx, ownerId): void` throws `NotOwnerError`
  - `assertAdmin(ctx): void` throws `AdminOnlyError`
  - `class NotOwnerError`, `class AdminOnlyError`
  - `permissionErrorResponse(err: unknown): NextResponse | null`
  - owner lookups: `getCampaignOwnerId(orgId, campaignId)`, `getSequenceOwnerId(orgId, sequenceId)`, `getStepOwnerId(orgId, stepId)`, `getVariantOwnerId(orgId, variantId)`, `getEnrollmentOwnerId(orgId, enrollmentId)`, `getDraftOwnerId(orgId, draftId)`, `getLeadOwnerId(orgId, leadId)`, `getMessageOwnerId(orgId, messageId)`. Each returns `Promise<string | null | undefined>`: `undefined` = not found in this org, `null` = unassigned.

- [ ] **Step 1: Write the failing tests**

`src/features/team/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { canAct, assertCanAct, assertAdmin, NotOwnerError, AdminOnlyError } from './permissions'

const admin = { isAdmin: true, member: { id: 'm-admin' } }
const rep = { isAdmin: false, member: { id: 'm-rep' } }

describe('canAct', () => {
  it('admins can act on anything, including unassigned', () => {
    expect(canAct(admin, 'm-other')).toBe(true)
    expect(canAct(admin, null)).toBe(true)
  })
  it('members can act only on what they own', () => {
    expect(canAct(rep, 'm-rep')).toBe(true)
    expect(canAct(rep, 'm-other')).toBe(false)
    expect(canAct(rep, null)).toBe(false)
  })
  it('assert helpers throw typed errors', () => {
    expect(() => assertCanAct(rep, 'm-other')).toThrow(NotOwnerError)
    expect(() => assertAdmin(rep)).toThrow(AdminOnlyError)
    expect(() => assertAdmin(admin)).not.toThrow()
  })
})
```

`src/lib/auth/resolve-member.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), clerkClient: vi.fn() }))
vi.mock('./resolve-organization', () => ({ resolveOrganization: vi.fn(async () => ({ id: 'org-1', clerkId: 'clerk-org' })) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { orgMember: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } } }))

import { auth, clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { resolveMember } from './resolve-member'

type Fn = ReturnType<typeof vi.fn>
const om = (prisma as unknown as { orgMember: Record<string, Fn> }).orgMember
const getUser = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(clerkClient).mockResolvedValue({ users: { getUser } } as never)
  om.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', clerkUserId: 'user_1', organizationId: 'org-1', role: 'admin', senderFirstName: null, senderLastName: null, lastSeenAt: new Date(), ...data }))
})

describe('resolveMember', () => {
  it('returns null without an org or user', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null, userId: 'u' } as never)
    expect(await resolveMember()).toBeNull()
  })

  it('creates a member on first sight, maps org:admin → admin, and fills name/email/sender names from Clerk', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1', orgRole: 'org:admin' } as never)
    om.findUnique.mockResolvedValue(null)
    om.create.mockResolvedValue({ id: 'm1', clerkUserId: 'user_1', organizationId: 'org-1', role: 'admin', senderFirstName: null, senderLastName: null, lastSeenAt: null })
    getUser.mockResolvedValue({ firstName: 'Justin', lastName: 'T', username: null, primaryEmailAddress: { emailAddress: 'justin@acme.com' }, emailAddresses: [] })
    const ctx = await resolveMember()
    expect(om.create).toHaveBeenCalledWith({ data: { clerkUserId: 'user_1', organizationId: 'org-1', role: 'admin' } })
    expect(ctx!.isAdmin).toBe(true)
    expect(om.update.mock.calls[0]![0].data).toMatchObject({ name: 'Justin T', email: 'justin@acme.com', senderFirstName: 'Justin', senderLastName: 'T', lastSeenAt: expect.any(Date) })
  })

  it('updates the role when Clerk changed it, and skips Clerk within the hour', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1', orgRole: 'org:member' } as never)
    om.findUnique.mockResolvedValue({ id: 'm1', role: 'admin', lastSeenAt: new Date(), senderFirstName: 'J', senderLastName: null })
    const ctx = await resolveMember()
    expect(om.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { role: 'member' } })
    expect(getUser).not.toHaveBeenCalled()
    expect(ctx!.isAdmin).toBe(false)
  })

  it('does not overwrite sender names the rep already set, and tolerates a Clerk failure', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1', orgRole: 'org:member' } as never)
    om.findUnique.mockResolvedValue({ id: 'm1', role: 'member', lastSeenAt: new Date(Date.now() - 2 * 3600_000), senderFirstName: 'Mike', senderLastName: 'R' })
    getUser.mockRejectedValue(new Error('clerk down'))
    const ctx = await resolveMember()
    expect(ctx).not.toBeNull()
    const data = om.update.mock.calls.at(-1)![0].data
    expect(data).toEqual({ lastSeenAt: expect.any(Date) })
  })
})
```

`src/features/team/server/owners.test.ts`: mock prisma and assert, for each lookup, the org-scoped query and the return mapping:
- `getCampaignOwnerId('org-1','c1')` calls `prisma.campaign.findFirst({ where: { id: 'c1', organizationId: 'org-1' }, select: { ownerId: true } })`. It returns `ownerId`, or `undefined` when the row is missing.
- `getSequenceOwnerId` uses `prisma.sequence.findFirst({ where: { id, organizationId }, select: { campaign: { select: { ownerId: true } } } })`.
- `getStepOwnerId` uses `prisma.sequenceStep.findFirst({ where: { id, sequence: { organizationId } }, select: { sequence: { select: { campaign: { select: { ownerId: true } } } } } })`.
- `getVariantOwnerId` uses `prisma.subjectVariant.findFirst({ where: { id, organizationId }, select: { sequenceStep: { select: { sequence: { select: { campaign: { select: { ownerId: true } } } } } } } })`.
- `getEnrollmentOwnerId` uses `prisma.sequenceEnrollment.findFirst({ where: { id, organizationId }, select: { sequence: { select: { campaign: { select: { ownerId: true } } } } } })`.
- `getDraftOwnerId` uses `prisma.draft.findFirst({ where: { id, organizationId }, select: { campaign: { select: { ownerId: true } }, lead: { select: { ownerId: true } } } })`. It returns the campaign owner when the draft has a campaign, else the lead owner.
- `getLeadOwnerId` uses `prisma.lead.findFirst({ where: { id, organizationId }, select: { ownerId: true } })`.
- `getMessageOwnerId` uses `prisma.outboundMessage.findFirst({ where: { id, organizationId }, select: { lead: { select: { ownerId: true } } } })`.

Write one `it` per lookup, covering both the found (including `null` unassigned) and the not-found → `undefined` cases.

Run: `npx vitest run src/features/team src/lib/auth/resolve-member.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/features/team/permissions.ts`:

```ts
export interface PermissionContext { isAdmin: boolean; member: { id: string } }

export class NotOwnerError extends Error {
  constructor() {
    super('You can only change your own campaigns and leads.')
    this.name = 'NotOwnerError'
    Object.setPrototypeOf(this, NotOwnerError.prototype)
  }
}

export class AdminOnlyError extends Error {
  constructor() {
    super('Only an admin can do this.')
    this.name = 'AdminOnlyError'
    Object.setPrototypeOf(this, AdminOnlyError.prototype)
  }
}

/** Admins act on everything; members only on what they own (unassigned = admin-only). */
export function canAct(ctx: PermissionContext, ownerId: string | null): boolean {
  if (ctx.isAdmin) return true
  return ownerId !== null && ownerId === ctx.member.id
}

export function assertCanAct(ctx: PermissionContext, ownerId: string | null): void {
  if (!canAct(ctx, ownerId)) throw new NotOwnerError()
}

export function assertAdmin(ctx: PermissionContext): void {
  if (!ctx.isAdmin) throw new AdminOnlyError()
}
```

`src/lib/auth/permission-response.ts`:

```ts
import { NextResponse } from 'next/server'
import { NotOwnerError, AdminOnlyError } from '@/features/team/permissions'

export function permissionErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof NotOwnerError) return NextResponse.json({ code: 'NOT_OWNER', error: err.message }, { status: 403 })
  if (err instanceof AdminOnlyError) return NextResponse.json({ code: 'ADMIN_ONLY', error: err.message }, { status: 403 })
  return null
}
```

`src/lib/auth/resolve-member.ts`:

```ts
import { auth, clerkClient } from '@clerk/nextjs/server'
import type { Organization, OrgMember } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { resolveOrganization } from './resolve-organization'

export interface MemberContext { org: Organization; member: OrgMember; isAdmin: boolean }

const REFRESH_MS = 60 * 60 * 1000

/**
 * The signed-in member of the active org, created on first sight and kept in
 * sync with Clerk (role every request; name/email at most hourly). Background
 * jobs read OrgMember rows directly and never call this.
 */
export async function resolveMember(): Promise<MemberContext | null> {
  const { orgId, userId, orgRole } = await auth()
  if (!orgId || !userId) return null
  const org = await resolveOrganization(orgId)
  const role = orgRole === 'org:admin' ? 'admin' : 'member'

  let member = await prisma.orgMember.findUnique({
    where: { clerkUserId_organizationId: { clerkUserId: userId, organizationId: org.id } },
  })
  if (!member) {
    member = await prisma.orgMember.create({ data: { clerkUserId: userId, organizationId: org.id, role } })
  } else if (member.role !== role) {
    member = await prisma.orgMember.update({ where: { id: member.id }, data: { role } })
  }
  if (!member.lastSeenAt || Date.now() - member.lastSeenAt.getTime() > REFRESH_MS) {
    member = await refreshFromClerk(member)
  }
  return { org, member, isAdmin: role === 'admin' }
}

async function refreshFromClerk(member: OrgMember): Promise<OrgMember> {
  const data: Record<string, unknown> = { lastSeenAt: new Date() }
  try {
    const client = await clerkClient()
    const user = await client.users.getUser(member.clerkUserId)
    const first = user.firstName?.trim() || null
    const last = user.lastName?.trim() || null
    data.name = [first, last].filter(Boolean).join(' ') || user.username || null
    data.email = user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null
    if (!member.senderFirstName && first) data.senderFirstName = first
    if (!member.senderLastName && last) data.senderLastName = last
  } catch (err) {
    console.warn('[resolveMember] Clerk refresh failed — keeping stored details', err)
  }
  return prisma.orgMember.update({ where: { id: member.id }, data })
}
```

Confirm the compound unique input name (`clerkUserId_organizationId`) against the generated client. Then implement `src/features/team/server/owners.ts` with the eight lookups exactly as the test describes, each as `async function x(orgId: string, id: string): Promise<string | null | undefined>`.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/features/team src/lib/auth && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/auth src/features/team
git commit -m "feat(team): resolve members from Clerk, permission helpers, owner lookups"
```

---

### Task 3: Guard campaign routes; campaigns get an owner

**Files:**
- Modify: `src/features/campaigns/server/campaign-sending.ts` (`createCampaign` gains `ownerId`)
- Modify:
  - `src/app/api/campaigns/route.ts`
  - `src/app/api/campaigns/[id]/route.ts`
  - `src/app/api/campaigns/[id]/approve-sample/route.ts`
  - `src/app/api/campaigns/[id]/content-override/route.ts`
  - `src/app/api/campaigns/[id]/placement-test/route.ts`
- Test: each route's `route.test.ts` (create where missing), plus `campaign-sending.test.ts`

**Interfaces:**
- Consumes: `resolveMember`, `canAct`, `permissionErrorResponse` / `NotOwnerError`, `getCampaignOwnerId` (Task 2).
- Produces: `createCampaign({ organizationId, name, description, ownerId })` persists `ownerId`.

**The guard pattern (apply in each route):**

```ts
const ctx = await resolveMember()
if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
const ownerId = await getCampaignOwnerId(ctx.org.id, id)
if (ownerId !== undefined && !canAct(ctx, ownerId)) {
  return NextResponse.json({ code: 'NOT_OWNER', error: 'You can only change your own campaigns and leads.' }, { status: 403 })
}
// …existing handler body, using ctx.org instead of the resolved org, and ctx.member.clerkUserId where userId was used…
```

When `ownerId === undefined`, continue into the existing logic; it already returns its own 404 for a missing campaign.

- [ ] **Step 1: Write the failing tests**

For each of the five routes, update or create its `route.test.ts`:
- Mock `@/lib/auth/resolve-member` (`resolveMember`) and `@/features/team/server/owners` (`getCampaignOwnerId`) instead of the old Clerk + `resolveOrganization` mocks. Keep the route's server-function mock.
- Add this table:

```ts
const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

it.each([
  ['another rep\'s campaign', rep, 'm-other', 403],
  ['an unassigned campaign', rep, null, 403],
  ['their own campaign', rep, 'm-rep', 200],
  ['any campaign as admin', admin, 'm-other', 200],
])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
  vi.mocked(resolveMember).mockResolvedValue(ctx as never)
  vi.mocked(getCampaignOwnerId).mockResolvedValue(ownerId)
  // arrange the underlying server function mock to succeed, as the file already does
  const res = await CALL_ROUTE()
  expect(res.status).toBe(status)
  if (status === 403) {
    expect((await res.json()).code).toBe('NOT_OWNER')
    expect(SERVER_FN).not.toHaveBeenCalled()
  }
})
```

Replace `CALL_ROUTE` and `SERVER_FN` with each route's real call and its underlying server function. Expected success statuses per route: `PATCH /api/campaigns/[id]` 200, `approve-sample` 200, `content-override` 200, `placement-test` 200. If a route's existing success status differs (e.g. 201), use it.

For `POST /api/campaigns`: a member (not admin) creating a campaign succeeds, and `createCampaign` is called with `ownerId: 'm-rep'`.

In `campaign-sending.test.ts`, check that `createCampaign` passes `ownerId` into `prisma.campaign.create`'s data.

Run: `npx vitest run src/app/api/campaigns src/features/campaigns`
Expected: FAIL.

- [ ] **Step 2: Implement**

- Apply the guard pattern to the four `[id]` routes.
- In `POST /api/campaigns`, use `resolveMember()` and call `createCampaign({ …, ownerId: ctx.member.id })`.
- Add `ownerId?: string | null` to `createCampaign`'s input and data.
- Where a route previously used Clerk `userId` (e.g. `approveCampaignSample` `clerkUserId`, content-override `clerkUserId`, placement-test `clerkUserId`), pass `ctx.member.clerkUserId`.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/app/api/campaigns src/features/campaigns && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/campaigns src/features/campaigns
git commit -m "feat(team): campaigns are owned; campaign routes enforce ownership"
```

---

### Task 4: Guard sequence routes; enrollment sets the lead owner

**Files:**
- Modify:
  - `src/app/api/sequences/route.ts`
  - `src/app/api/sequences/[id]/route.ts`
  - `src/app/api/sequences/[id]/enroll/route.ts`
  - `src/app/api/sequences/enrollments/[id]/route.ts`
  - `src/app/api/sequences/steps/[stepId]/variants/route.ts`
  - `src/app/api/sequences/steps/[stepId]/winner/route.ts`
  - `src/app/api/sequences/variants/[variantId]/route.ts`
- Modify: `src/features/sequences/server/enroll-lead.ts`
- Test: each route's `route.test.ts` (create where missing), plus `enroll-lead.test.ts`

**Interfaces:**
- Consumes: `resolveMember`, `canAct`, and the owner lookups `getCampaignOwnerId` (for `POST /api/sequences`, keyed on `body.campaignId`), `getSequenceOwnerId`, `getEnrollmentOwnerId`, `getStepOwnerId`, `getVariantOwnerId`.
- Produces: `enrollLead` sets `lead.ownerId = campaign.ownerId` inside its transaction when the lead has no owner and the campaign has one.

**The guard pattern (each route, with its lookup):**

```ts
const ctx = await resolveMember()
if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
const ownerId = await LOOKUP(ctx.org.id, ID)
if (ownerId !== undefined && !canAct(ctx, ownerId)) {
  return NextResponse.json({ code: 'NOT_OWNER', error: 'You can only change your own campaigns and leads.' }, { status: 403 })
}
```

Keep each route's existing unauthenticated status (401 or 403) exactly as it is today.

- [ ] **Step 1: Write the failing tests**

For every method in the file list (8 handlers: sequences POST, sequences/[id] PATCH, enroll POST, enrollments PATCH, variants POST, winner POST, variants/[variantId] PATCH and DELETE), add the same four-row table as Task 3:
- rep on another rep's → 403 `NOT_OWNER`, and the server function is not called
- rep on unassigned → 403
- rep on own → success
- admin on another's → success

Mock `resolveMember` and the relevant owner lookup.

In `enroll-lead.test.ts`:
- Extend the `sequence.findFirst` mock result with `campaign: { ownerId: 'm-rep' }`, and have the enrollment code select it.
- Add tests:
  - an unowned lead enrolled in a campaign owned by `m-rep` → `tx.lead.updateMany({ where: { id: 'lead-1', ownerId: null }, data: { ownerId: 'm-rep' } })`
  - a lead already owned → `updateMany` is called with the same `ownerId: null` condition, so it's a no-op (or isn't called)
  - an unowned campaign → not called

Run: `npx vitest run src/app/api/sequences src/features/sequences/server/enroll-lead.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

- Apply the guard pattern to each handler. Replace `resolveOrganization(orgId)` with `ctx.org`, and Clerk `userId` with `ctx.member.clerkUserId` where it's passed as an actor.
- In `enroll-lead.ts`, add `campaign: { select: { ownerId: true } }` to the sequence query. Inside the transaction, when `sequence.campaign.ownerId`:

```ts
      await tx.lead.updateMany({ where: { id: leadId, ownerId: null }, data: { ownerId: sequence.campaign.ownerId } })
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/app/api/sequences src/features/sequences && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/sequences src/features/sequences
git commit -m "feat(team): sequence routes enforce ownership; enrollment assigns the lead owner"
```

---

### Task 5: Guard draft, lead and message routes; admin-only settings routes

**Files:**
- Modify (owner-checked):
  - `src/app/api/drafts/[id]/review/route.ts`
  - `src/app/api/drafts/[id]/send/route.ts`
  - `src/app/api/drafts/generate/route.ts`
  - `src/app/api/leads/[id]/status/route.ts`
  - `src/app/api/messages/[id]/retry/route.ts`
- Modify (admin-only):
  - `src/app/api/settings/sending/route.ts`
  - `src/app/api/settings/business-profile/route.ts` (PUT only; GET stays for all members)
  - `src/app/api/settings/business-profile/rescore/route.ts`
  - `src/app/api/mailboxes/route.ts` (POST)
  - `src/app/api/mailboxes/[id]/route.ts` (PATCH)
  - `src/app/api/integrations/microsoft/mailboxes/route.ts` (POST)
  - `src/app/api/deliverability/domains/[id]/route.ts` (PATCH)
  - `src/app/api/deliverability/domains/[id]/recheck/route.ts` (POST)
  - `src/app/api/templates/route.ts` (POST)
  - `src/app/api/templates/[id]/route.ts` (PATCH)
- Test: each route's `route.test.ts` (create where missing)

**Interfaces:**
- Consumes: `resolveMember`, `canAct`, `assertAdmin`, `permissionErrorResponse`, `getDraftOwnerId`, `getLeadOwnerId`, `getMessageOwnerId`.

**Owner-checked routes** use the Task 3/4 guard pattern with:
- `getDraftOwnerId` for review and send
- `getLeadOwnerId(ctx.org.id, body.leadId)` for generate (after body validation)
- `getLeadOwnerId` for lead status
- `getMessageOwnerId` for retry

**Admin-only routes:**

```ts
const ctx = await resolveMember()
if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
if (!ctx.isAdmin) return NextResponse.json({ code: 'ADMIN_ONLY', error: 'Only an admin can do this.' }, { status: 403 })
```

- [ ] **Step 1: Write the failing tests**

- **Owner-checked routes:** the same four-row table as Task 3, with the relevant lookup mocked.
- **Admin-only routes:** a two-row table:
  - a non-admin → 403 `ADMIN_ONLY`, and the server function is not called (Review Focus #5)
  - an admin → the route's normal success status
- **Unchanged routes:** add one test each for `leads/import` POST and `inbox/[leadId]/read` PATCH, showing a non-admin member still succeeds (they now use `resolveMember`, or keep `resolveOrganization` if they only need the org).

Update existing tests in these files to mock `resolveMember` instead of Clerk + `resolveOrganization`.

Run: `npx vitest run src/app/api/drafts src/app/api/leads src/app/api/messages src/app/api/settings src/app/api/mailboxes src/app/api/integrations src/app/api/deliverability src/app/api/templates src/app/api/inbox`
Expected: new tests FAIL.

- [ ] **Step 2: Implement**

- Apply the guards.
- Replace `resolveOrganization(orgId)` with `ctx.org`, and Clerk `userId` with `ctx.member.clerkUserId`, where passed as an actor.
- Keep every other status code and error mapping unchanged.

- [ ] **Step 3: Run the tests**

Run the same command as Step 1, then `npx tsc --noEmit && npx vitest run`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api
git commit -m "feat(team): draft/lead/message routes enforce ownership; settings routes admin-only"
```

---

### Task 6: Mailbox choice by owner

**Files:**
- Create: `src/features/team/server/mailbox-owner.ts`
- Test: `src/features/team/server/mailbox-owner.test.ts`
- Modify: `src/features/sequences/server/assign-mailbox.ts` (+ its test)
- Modify: `src/features/messages/server/send-draft.ts`, the non-sequence rotation branch (+ `send-draft.test.ts`)

**Interfaces:**
- Produces: `mailboxOwnerFilter(organizationId: string, ownerId: string | null): Promise<{ ownerId: string | null }>`
  - returns `{ ownerId }` when `ownerId` is set and that member owns ≥ 1 mailbox in the org
  - otherwise `{ ownerId: null }` (shared mailboxes)

- [ ] **Step 1: Write the failing tests**

`mailbox-owner.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/db/prisma', () => ({ prisma: { mailbox: { count: vi.fn() } } }))
import { prisma } from '@/lib/db/prisma'
import { mailboxOwnerFilter } from './mailbox-owner'
const count = (prisma as unknown as { mailbox: { count: ReturnType<typeof vi.fn> } }).mailbox.count
beforeEach(() => vi.resetAllMocks())

describe('mailboxOwnerFilter', () => {
  it('uses the owner\'s mailboxes when they own any', async () => {
    count.mockResolvedValue(2)
    expect(await mailboxOwnerFilter('org-1', 'm-rep')).toEqual({ ownerId: 'm-rep' })
    expect(count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', ownerId: 'm-rep' } })
  })
  it('falls back to shared mailboxes when the owner has none, or there is no owner (Review Focus #4)', async () => {
    count.mockResolvedValue(0)
    expect(await mailboxOwnerFilter('org-1', 'm-rep')).toEqual({ ownerId: null })
    expect(await mailboxOwnerFilter('org-1', null)).toEqual({ ownerId: null })
  })
})
```

In `assign-mailbox.test.ts`, add:
- the enrollment's campaign owner is read (mock `sequenceEnrollment.findUnique` / `findFirst` as the implementation does)
- `mailbox.findMany`'s `where` includes the filter result
- **an owner whose mailboxes are all auto-paused/inactive, or all on failing domains → returns `null`, and no shared mailbox is used** (Review Focus #2): `findMany` returns `[]` for the owner filter
- **unowned campaign + all-unowned mailboxes → behaves exactly as before** (Review Focus #4)

In `send-draft.test.ts`:
- a non-sequence draft whose lead is owned by `m-rep`: the rotation query includes `ownerId: 'm-rep'` when the rep owns mailboxes
- a lead with no owner → `ownerId: null`

Run: `npx vitest run src/features/team src/features/sequences/server/assign-mailbox.test.ts src/features/messages/server/send-draft.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`mailbox-owner.ts`:

```ts
import { prisma } from '@/lib/db/prisma'

/**
 * Which mailboxes a send may use: the owner's own when they have any (even if
 * all are currently paused — then the send waits), otherwise shared ones.
 */
export async function mailboxOwnerFilter(organizationId: string, ownerId: string | null): Promise<{ ownerId: string | null }> {
  if (!ownerId) return { ownerId: null }
  const owned = await prisma.mailbox.count({ where: { organizationId, ownerId } })
  return owned > 0 ? { ownerId } : { ownerId: null }
}
```

In `assignEnrollmentMailbox`:
- Before the `mailbox.findMany`, load the enrollment's campaign owner:

```ts
  const enrollment = await prisma.sequenceEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { sequence: { select: { campaign: { select: { ownerId: true } } } } },
  })
  const ownerFilter = await mailboxOwnerFilter(organizationId, enrollment?.sequence.campaign.ownerId ?? null)
```

- Spread `...ownerFilter` into the `findMany` `where`.

In `sendDraft`'s non-sequence rotation branch (the `mailbox.findMany` used when `draft.sequenceEnrollmentId` is null):
- Add `ownerId: true` to the draft's lead select.
- Spread `...(await mailboxOwnerFilter(organizationId, draft.lead.ownerId ?? null))` into that `where`.

The pinned-enrollment branch is unchanged.

- [ ] **Step 3: Run the tests**

Run the Step 1 command, then `npx tsc --noEmit`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/team src/features/sequences/server src/features/messages/server
git commit -m "feat(team): send from the owner's mailboxes, shared mailboxes as fallback"
```

---

### Task 7: Sender merge fields and starter templates

**Files:**
- Create: `src/features/team/sender-fields.ts` (pure)
- Test: `src/features/team/sender-fields.test.ts`
- Create: `src/features/team/server/campaign-sender.ts`
- Test: `src/features/team/server/campaign-sender.test.ts`
- Modify:
  - `src/features/sequences/server/run-sequence-step.ts`
  - `src/features/placement-test/server/send-placement-test.ts`
  - `src/features/business-profile/starter-sequences.ts`
- Tests: existing tests of those three

**Interfaces:**
- Produces:
  - `interface SenderFields { senderFirstName: string | null; senderName: string | null }`
  - `withSenderFields<T extends { customFields?: unknown }>(lead: T, sender: SenderFields): T`. It adds `senderFirstName` / `senderName` to `customFields` when non-null; existing keys win.
  - `getCampaignSender(organizationId: string, campaignId: string): Promise<SenderFields>`

- [ ] **Step 1: Write the failing tests**

`sender-fields.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { withSenderFields } from './sender-fields'
import { renderTemplate } from '@/features/sequences/render-template'

describe('withSenderFields', () => {
  it('adds sender merge fields that render', () => {
    const lead = withSenderFields({ firstName: 'Jo', customFields: { city: 'Buffalo' } }, { senderFirstName: 'Mike', senderName: 'Mike Rossi' })
    expect(renderTemplate('Thanks,\n{senderFirstName|}', lead)).toBe('Thanks,\nMike')
    expect(renderTemplate('{senderName|Our team}', lead)).toBe('Mike Rossi')
  })
  it('uses the fallback when there is no sender', () => {
    const lead = withSenderFields({ customFields: null }, { senderFirstName: null, senderName: null })
    expect(renderTemplate('Thanks,\n{senderFirstName|}', lead)).toBe('Thanks,\n')
  })
  it('never overrides a real CSV column with the same key', () => {
    const lead = withSenderFields({ customFields: { senderFirstName: 'FromCsv' } }, { senderFirstName: 'Mike', senderName: 'Mike R' })
    expect(renderTemplate('{senderFirstName|}', lead)).toBe('FromCsv')
  })
})
```

`campaign-sender.test.ts`: mock prisma `campaign.findFirst` returning `{ owner: { senderFirstName: 'Mike', senderLastName: 'Rossi', name: 'Michael Rossi' } }` and expect `{ senderFirstName: 'Mike', senderName: 'Mike Rossi' }`. Also cover:
- no owner → both null
- owner with only `name` → `senderFirstName` = the first word of `name`, `senderName` = `name`
- the query is org-scoped (`where: { id, organizationId }`)

In `run-sequence-step.test.ts`:
- mock `@/features/team/server/campaign-sender` to return `{ senderFirstName: 'Mike', senderName: 'Mike Rossi' }`
- a step body ending `Thanks,\n{senderFirstName|}` renders `Thanks,\nMike` in the created draft

Add the same assertion to `send-placement-test.test.ts`, via the sent email body.

`starter-sequences.test.ts` needs no change in its rules. Add one assertion: every step body ends with `Thanks,\n{senderFirstName|}`.

Run: `npx vitest run src/features/team src/features/sequences src/features/placement-test src/features/business-profile/starter-sequences.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`sender-fields.ts`:

```ts
export interface SenderFields { senderFirstName: string | null; senderName: string | null }

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Adds {senderFirstName} / {senderName} merge fields; real CSV columns win. */
export function withSenderFields<T extends { customFields?: unknown }>(lead: T, sender: SenderFields): T {
  const derived: Record<string, string> = {}
  if (sender.senderFirstName) derived.senderFirstName = sender.senderFirstName
  if (sender.senderName) derived.senderName = sender.senderName
  return { ...lead, customFields: { ...derived, ...asRecord(lead.customFields) } }
}
```

`campaign-sender.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type { SenderFields } from '../sender-fields'

export async function getCampaignSender(organizationId: string, campaignId: string): Promise<SenderFields> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { owner: { select: { senderFirstName: true, senderLastName: true, name: true } } },
  })
  const owner = campaign?.owner
  if (!owner) return { senderFirstName: null, senderName: null }
  const first = owner.senderFirstName?.trim() || owner.name?.trim().split(/\s+/)[0] || null
  const full = [owner.senderFirstName?.trim(), owner.senderLastName?.trim()].filter(Boolean).join(' ') || owner.name?.trim() || null
  return { senderFirstName: first, senderName: full }
}
```

In `run-sequence-step.ts` and `send-placement-test.ts`:
- fetch `const sender = await getCampaignSender(organizationId, campaignId)` next to `getLeadContext`
- wrap the render lead: `withSenderFields(templateLeadWithFacts(lead, context.facts), sender)`

In `starter-sequences.ts`, change every step's closing `Thanks,` to `Thanks,\n{senderFirstName|}`.

- [ ] **Step 3: Run the tests**

Run the Step 1 command, then `npx tsc --noEmit`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/team src/features/sequences src/features/placement-test src/features/business-profile/starter-sequences.ts src/features/business-profile/starter-sequences.test.ts
git commit -m "feat(team): {senderFirstName} {senderName} from the campaign owner; templates sign as the rep"
```

---

### Task 8: Reply alerts route to the owner

**Files:**
- Modify: `src/lib/email/graph/mail.ts` (`sendMailAsText` gains optional `cc`) (+ test)
- Create: `src/features/team/server/alert-recipients.ts`
- Test: `src/features/team/server/alert-recipients.test.ts`
- Modify: `src/features/replies/server/notify.ts` (+ test)

**Interfaces:**
- Produces:
  - `sendMailAsText(tenantId, fromMailbox, to, subject, text, cc?: string | null)`. When `cc` is set, the message JSON includes `ccRecipients: [{ emailAddress: { address: cc } }]`.
  - `resolveAlertRecipients(organizationId: string, refs?: { leadId?: string | null; mailboxId?: string | null }): Promise<{ to: string | null; cc: string | null }>`

- [ ] **Step 1: Write the failing tests**

`alert-recipients.test.ts`, mocking prisma `organization.findUnique`, `lead.findFirst` and `mailbox.findFirst`:
- **lead owner wins:** `to` = the lead owner's `escalationEmail`
- **fallback to email:** a lead owner with no `escalationEmail` uses their `email`
- **mailbox owner next:** no lead owner → the mailbox owner's address
- **org last:** neither → `Organization.escalationEmail`
- **no address anywhere** (the lead owner has neither `escalationEmail` nor `email`, no mailbox owner) → falls to the org, and never throws (Review Focus #3)
- **cc on:** `copyAdminOnReplies` true and the org address differs → `cc` = the org address
- **cc skipped:** when the addresses are equal (case-insensitive) → `cc` null; with `copyAdminOnReplies` false → `cc` null
- **no refs** (system alert) → `to` = the org address, `cc` null (Review Focus #4)
- **org-scoped queries:** the lead and mailbox lookups use `where: { id, organizationId }`

`notify.test.ts`:
- `notifyReply` resolves recipients with the reply's `leadId` and `mailboxId`, and calls `sendMailAsText(…, to, subject, text, cc)`
- `notifyUnmatchedReply` passes only `mailboxId`
- `sendOrgAlert` still sends to the org address only, with no cc

Add a `cc` case to `mail.test.ts`.

Run: `npx vitest run src/features/team src/features/replies src/lib/email/graph`
Expected: FAIL.

- [ ] **Step 2: Implement**

In `mail.ts`:
- `messageBody` accepts `cc?: string | null` and adds `ccRecipients` when set
- `sendMailAsText` gains the optional `cc` parameter and passes it through

`alert-recipients.ts`:

```ts
import { prisma } from '@/lib/db/prisma'

type Person = { escalationEmail: string | null; email: string | null } | null | undefined

function address(p: Person): string | null {
  return p?.escalationEmail?.trim() || p?.email?.trim() || null
}

/** Reply alerts go to the owning rep (lead owner → mailbox owner → org), CC the org when enabled. */
export async function resolveAlertRecipients(
  organizationId: string,
  refs: { leadId?: string | null; mailboxId?: string | null } = {},
): Promise<{ to: string | null; cc: string | null }> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { escalationEmail: true, copyAdminOnReplies: true } })
  const orgAddress = org?.escalationEmail?.trim() || null
  const owner = { select: { escalationEmail: true, email: true } } as const
  const lead = refs.leadId ? await prisma.lead.findFirst({ where: { id: refs.leadId, organizationId }, select: { owner } }) : null
  const mailbox = refs.mailboxId ? await prisma.mailbox.findFirst({ where: { id: refs.mailboxId, organizationId }, select: { owner } }) : null
  const to = address(lead?.owner) ?? address(mailbox?.owner) ?? orgAddress
  const cc = org?.copyAdminOnReplies && orgAddress && to && orgAddress.toLowerCase() !== to.toLowerCase() ? orgAddress : null
  return { to, cc }
}
```

In `notify.ts`:
- `deliver(organizationId, subject, text, refs?)` uses `resolveAlertRecipients(organizationId, refs)`
- it keeps the existing "missing address / msTenantId / MS_NOTIFY_MAILBOX → warn, return false" when `to` is null
- it calls `sendMailAsText(org.msTenantId, from, to, subject, text, cc)`
- `notifyReply` passes `{ leadId: reply.leadId, mailboxId: reply.mailboxId }` (select those fields)
- `notifyUnmatchedReply` passes `{ mailboxId: reply.mailboxId }`
- `sendOrgAlert` passes no refs

- [ ] **Step 3: Run the tests**

Run the Step 1 command, then `npx tsc --noEmit`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/team src/features/replies src/lib/email/graph
git commit -m "feat(team): reply alerts go to the owning rep, CC admin when enabled"
```

---

### Task 9: Owner filters and owner names in list functions

**Files:**
- Create: `src/features/team/view.ts` (pure)
- Test: `src/features/team/view.test.ts`
- Modify, with each file's test:
  - `src/features/leads/server/get-leads.ts`
  - `src/features/leads/server/get-pipeline-leads.ts`
  - `src/features/campaigns/server/get-campaigns.ts`
  - `src/features/sequences/server/get-sequences.ts`
  - `src/features/drafts/server/get-drafts.ts`
  - `src/features/inbox/server/get-inbox-threads.ts`
  - `src/features/replies/server/get-replies.ts`
  - `src/features/dashboard/server/get-dashboard-summary.ts`
- Modify: the matching DTO types (`src/features/leads/types.ts`, the campaigns DTO, the inbox thread DTO)

**Interfaces:**
- Produces:
  - `type ViewMode = 'mine' | 'team'`
  - `resolveView(isAdmin: boolean, param: string | string[] | undefined): ViewMode`
  - `ownerFilterFor(view: ViewMode, memberId: string): string | undefined`
  - Each list function gains an optional `ownerId?: string` input. When set, it filters:
    - **leads / pipeline:** `ownerId`
    - **campaigns:** `ownerId`
    - **sequences:** `campaign: { ownerId }`
    - **drafts:** `OR: [{ campaign: { ownerId } }, { campaignId: null, lead: { ownerId } }]`
    - **inbox threads and replies:** `lead: { ownerId }`, plus unmatched items with `mailbox: { ownerId }` wherever unmatched replies are listed
    - **dashboard summary:** counts use the same lead/campaign filters
  - DTOs gain `ownerName: string | null` on `LeadDTO`, the campaign list DTO and the inbox thread DTO (from `owner.name ?? owner.email`)

- [ ] **Step 1: Write the failing tests**

`view.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveView, ownerFilterFor } from './view'

describe('resolveView', () => {
  it('defaults to mine for members and team for admins', () => {
    expect(resolveView(false, undefined)).toBe('mine')
    expect(resolveView(true, undefined)).toBe('team')
  })
  it('honors a valid param and ignores junk', () => {
    expect(resolveView(false, 'team')).toBe('team')
    expect(resolveView(true, 'mine')).toBe('mine')
    expect(resolveView(false, 'everything')).toBe('mine')
    expect(resolveView(true, ['mine', 'team'])).toBe('mine')
  })
})

describe('ownerFilterFor', () => {
  it('filters by me only in mine view', () => {
    expect(ownerFilterFor('mine', 'm1')).toBe('m1')
    expect(ownerFilterFor('team', 'm1')).toBeUndefined()
  })
})
```

For each list function, add two tests to its existing test file:
- with `ownerId: 'm1'`, the Prisma `where` includes the filter above
- without `ownerId`, the `where` is exactly as before

For the three DTO-bearing functions, also assert `ownerName` maps from the included `owner`.

Run: `npx vitest run src/features/team src/features/leads src/features/campaigns src/features/sequences src/features/drafts src/features/inbox src/features/replies src/features/dashboard`
Expected: new tests FAIL.

- [ ] **Step 2: Implement**

`view.ts`:

```ts
export type ViewMode = 'mine' | 'team'

export function resolveView(isAdmin: boolean, param: string | string[] | undefined): ViewMode {
  const value = Array.isArray(param) ? param[0] : param
  if (value === 'mine' || value === 'team') return value
  return isAdmin ? 'team' : 'mine'
}

export function ownerFilterFor(view: ViewMode, memberId: string): string | undefined {
  return view === 'mine' ? memberId : undefined
}
```

Add the optional `ownerId` to each list function exactly as listed above. Use a conditional spread, so an absent `ownerId` leaves the query unchanged. Include `owner: { select: { name: true, email: true } }` where `ownerName` is added, then map it. Fix fixtures that `tsc` flags (`ownerName: null`).

- [ ] **Step 3: Run the tests**

Run the Step 1 command, then `npx tsc --noEmit && npx vitest run`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features
git commit -m "feat(team): owner filters and owner names in list functions"
```

---

### Task 10: Mine / Team toggle and owner display on pages

**Files:**
- Create: `src/features/team/components/view-toggle.tsx`
- Test: `src/features/team/components/view-toggle.test.tsx`
- Create: `src/features/team/components/owner-badge.tsx`
- Modify the pages and their clients: `src/app/(dashboard)/` `leads`, `pipeline`, `campaigns`, `sequences`, `drafts`, `inbox`, `replies`, `dashboard` (each page's `page.tsx`, and the client list component rendering the table)

**Interfaces:**
- Consumes: `resolveMember`, `resolveView`, `ownerFilterFor`, the list functions' `ownerId`, and the `ownerName` DTO fields.
- Produces:
  - `<ViewToggle view={ViewMode} />`
  - `<OwnerBadge name={string | null} />`, which renders the name or "Unassigned"

- [ ] **Step 1: Write the failing tests**

`view-toggle.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

const push = vi.fn()
const replace = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace }), usePathname: () => '/leads', useSearchParams: () => search }))

import { ViewToggle } from './view-toggle'

beforeEach(() => { vi.resetAllMocks(); search = new URLSearchParams(); window.localStorage.clear() })

describe('ViewToggle', () => {
  it('shows both options with the current one pressed', () => {
    render(<ViewToggle view="mine" />)
    expect(screen.getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Team' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('switching writes ?view= and remembers the choice', () => {
    render(<ViewToggle view="mine" />)
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    expect(push).toHaveBeenCalledWith('/leads?view=team')
    expect(window.localStorage.getItem('outboundos:view')).toBe('team')
  })

  it('restores the remembered choice when the URL has none', () => {
    window.localStorage.setItem('outboundos:view', 'team')
    render(<ViewToggle view="mine" />)
    expect(replace).toHaveBeenCalledWith('/leads?view=team')
  })

  it('does not override an explicit ?view=', () => {
    search = new URLSearchParams('view=mine')
    window.localStorage.setItem('outboundos:view', 'team')
    render(<ViewToggle view="mine" />)
    expect(replace).not.toHaveBeenCalled()
  })

  it('works when localStorage throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    render(<ViewToggle view="mine" />)
    fireEvent.click(screen.getByRole('button', { name: 'Team' }))
    expect(push).toHaveBeenCalledWith('/leads?view=team')
    spy.mockRestore()
  })
})
```

For each list client component already covered by a test (e.g. `leads-table.test.tsx`), add an assertion that the Owner column shows the owner's name, and "Unassigned" for null.

Run: `npx vitest run src/features/team/components src/features/leads/components`
Expected: FAIL.

- [ ] **Step 2: Implement**

- **`ViewToggle`:** two buttons ("Mine", "Team") with `aria-pressed`. On click it writes `localStorage` (try/catch) and does `router.push(pathname + '?' + params)`, where `params` is the current search params with `view` set. On mount, when the URL has no `view` and the stored value differs from `view`, it calls `router.replace`. Style it like the existing segmented controls or buttons.
- **Each page:**
  - `const ctx = await resolveMember()` (redirect to `/dashboard` when null, matching the page's current behavior)
  - `const view = resolveView(ctx.isAdmin, (await searchParams).view)`
  - pass `ownerId: ownerFilterFor(view, ctx.member.id)` to the list function
  - render `<ViewToggle view={view} />` beside the page header
- **Owner columns:** add an "Owner" column (`OwnerBadge`) to the Leads table, Campaigns list and Inbox thread list. Hide it at narrow widths the same way other secondary columns are hidden (`hidden md:table-cell`), so 375 px doesn't overflow.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/features "src/app/(dashboard)" && npx tsc --noEmit && npx eslint src/features/team "src/app/(dashboard)"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features "src/app/(dashboard)"
git commit -m "feat(team): Mine / Team views and owner columns"
```

---

### Task 11: Assigning owners

**Files:**
- Create: `src/app/api/campaigns/[id]/owner/route.ts` (+ test)
- Create: `src/app/api/leads/[id]/owner/route.ts` (+ test)
- Modify: `src/app/api/mailboxes/[id]/route.ts` (PATCH accepts `{ ownerId }`, already admin-only after Task 5) (+ test)
- Create: `src/features/team/server/assign-owner.ts`
- Test: `src/features/team/server/assign-owner.test.ts`
- Create: `src/features/team/components/owner-select.tsx`
- Test: `src/features/team/components/owner-select.test.tsx`
- Modify: the campaign detail page, the lead detail client, and the Settings mailbox list (render `OwnerSelect` for admins)

**Interfaces:**
- Produces:
  - `assignOwner(organizationId, entity: 'campaign' | 'lead' | 'mailbox', id: string, ownerId: string | null): Promise<boolean>`. It returns false when the entity isn't in the org, and throws `InvalidOwnerError` when `ownerId` isn't a member of the org.
  - `listMembers(organizationId): Promise<{ id: string; name: string | null; email: string | null; role: string }[]>`
  - `<OwnerSelect endpoint={string} members={…} value={string | null} note?={string} />`, which PATCHes `{ ownerId }` and refreshes

- [ ] **Step 1: Write the failing tests**

- **`assign-owner.test.ts`:**
  - an org-scoped `updateMany({ where: { id, organizationId }, data: { ownerId } })` per entity
  - `ownerId` validated with `orgMember.findFirst({ where: { id: ownerId, organizationId } })`, throwing `InvalidOwnerError` when missing
  - null allowed (unassign)
  - returns false when count is 0
- **Owner routes:**
  - non-admin → 403 `ADMIN_ONLY`
  - admin → 200
  - unknown entity → 404
  - an invalid `ownerId` → 400
  - bad body → 400
- **Mailbox route:** `{ ownerId }` is accepted and applied; the existing fields still work.
- **`owner-select.test.tsx`:**
  - lists "Unassigned" plus the members
  - changing the selection PATCHes the endpoint with the chosen id (or `null`)
  - shows the `note` when given
  - shows server errors in `role="alert"`
  - resets busy in `finally`

Run: `npx vitest run src/features/team src/app/api/campaigns src/app/api/leads src/app/api/mailboxes`
Expected: new tests FAIL.

- [ ] **Step 2: Implement**

- `assign-owner.ts` as specified, and `listMembers` (ordered by name).
- The two routes: admin-only; body `{ ownerId: string | null }`; map `InvalidOwnerError` → 400 and `false` → 404.
- In the mailbox PATCH, accept `ownerId` and call `assignOwner(…, 'mailbox', …)`.
- `OwnerSelect`: a labelled `Select` ("Owner").
- **Pages:**
  - Campaign detail: admins see `OwnerSelect` with note "Existing sequences keep sending from their current mailbox."; others see `OwnerBadge`.
  - Lead page: admins see `OwnerSelect`; others see `OwnerBadge`.
  - Settings mailbox list: admins get an `OwnerSelect` per mailbox.

- [ ] **Step 3: Run the tests**

Run the Step 1 command, then `npx tsc --noEmit && npx eslint src/features/team`.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/team src/app/api "src/app/(dashboard)"
git commit -m "feat(team): admins assign owners to campaigns, leads and mailboxes"
```

---

### Task 12: Team settings, My settings, copy toggle, assignment banner

**Files:**
- Create: `src/features/team/server/team-settings.ts`
- Test: `src/features/team/server/team-settings.test.ts`
- Create: `src/app/api/team/members/[id]/route.ts` (+ test)
- Create: `src/app/api/team/settings/route.ts` (+ test)
- Create: `src/features/team/components/team-section.tsx`
- Create: `src/features/team/components/my-settings.tsx`
- Create: `src/features/team/components/ownership-banner.tsx`
- Test: `src/features/team/components/team-ui.test.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx` and `settings-client.tsx` (render Team + My settings; render the admin-only sections read-only or hidden for members)
- Modify: `src/app/(dashboard)/dashboard/page.tsx` (banner)

**Interfaces:**
- Produces:
  - `getTeam(organizationId)` → `{ members: { id; name; email; role; escalationEmail; senderFirstName; senderLastName; mailboxCount; lastSeenAt }[]; copyAdminOnReplies: boolean; unassignedCampaigns: number; unassignedMailboxes: number; bannerDismissed: boolean }`
  - `updateMember(organizationId, memberId, patch: { escalationEmail?: string | null; senderFirstName?: string | null; senderLastName?: string | null })`. It validates the email format (the same regex as sending settings), trims, turns empty strings into null, caps names at 40 characters, and throws `TeamValidationError`.
  - `updateTeamSettings(organizationId, patch: { copyAdminOnReplies?: boolean; dismissOwnershipBanner?: true })`

- [ ] **Step 1: Write the failing tests**

- **`team-settings.test.ts`:**
  - `getTeam` counts mailboxes per member and unassigned campaigns and mailboxes
  - `updateMember` validation (bad email → error; `''` → null)
  - it's org-scoped (`updateMany where { id, organizationId }`, returns false on 0)
  - `updateTeamSettings` sets `ownershipBannerDismissedAt` to a Date on dismiss
- **`PATCH /api/team/members/[id]`:**
  - admin editing anyone → 200
  - a member editing themselves → 200
  - a member editing someone else → 403 `NOT_OWNER`
  - validation → 400
  - unknown → 404
- **`PATCH /api/team/settings`:** non-admin → 403 `ADMIN_ONLY`; admin → 200.
- **`team-ui.test.tsx`:**
  - `TeamSection` lists members with role and mailbox count, and shows the "Roles are managed in Clerk" note; the copy toggle PATCHes
  - `MySettings` saves the escalation email and sender names, showing errors in `role="alert"`
  - `OwnershipBanner` renders only when `isAdmin && !dismissed && (unassignedCampaigns + unassignedMailboxes) > 0`, links to `/campaigns?view=team` and `/settings`, and Dismiss PATCHes `{ dismissOwnershipBanner: true }`
  - a non-admin viewing Settings sees the sending, business-profile and mailbox sections read-only or hidden, with no errors (Review Focus #5)

Run: `npx vitest run src/features/team src/app/api/team`
Expected: FAIL.

- [ ] **Step 2: Implement**

Build the server functions, routes and components as specified, matching the existing Settings card styling. On the Settings page:
- `resolveMember()`
- pass `isAdmin`
- render `TeamSection` (admins get editable rows; members get a read-only list) and `MySettings` (always)
- for non-admins, render the existing admin sections disabled, or hide them behind "Ask an admin to change these settings."

Dashboard: load `getTeam` counts for admins and render `OwnershipBanner`.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/features/team src/app/api/team "src/app/(dashboard)/settings" && npx tsc --noEmit && npx eslint src/features/team "src/app/(dashboard)"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/team src/app/api/team "src/app/(dashboard)"
git commit -m "feat(team): Team settings, My settings, admin copy toggle, assignment banner"
```

---

### Task 13: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Add a `## Team & rep ownership` section after `## Business profile & lead scoring`, covering:
  - Reps sign in once to appear. Admin / member comes from the Clerk organization role.
  - Assigning owners: Campaigns (creator by default), leads (from their first owned campaign), mailboxes (Settings → Team / mailbox list). Plus the banner.
  - What reps can and can't do (the permission table from the spec, condensed).
  - Sending as the rep: the owner's mailboxes, the shared fallback, the wait when the owner's mailboxes are all paused, and existing sequences keeping their mailbox.
  - `{senderFirstName|…}` and `{senderName|…}`; the starter templates sign automatically.
  - Reply alerts: owner routing, "My settings" escalation email, and "Copy admin on reps' replies" (on by default). System alerts still go to the org address.
  - The Mine / Team toggle.
- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: team and rep ownership"
```

---

## Self-review notes (for the executor)

**Spec coverage**

| Spec section | Task(s) |
|---|---|
| 1. Members and roles, sync, permissions, enforcement | 1, 2, 3, 4, 5 |
| 2. Ownership data + how owners get set | 1, 3, 4 |
| 3. Sending as the rep (mailbox choice, manual rotation, sender fields, templates) | 6, 7 |
| 4. Reply routing + cc + admin copy | 8, 12 |
| 5. Views, owner display, reassignment, Team / My settings, banner | 9, 10, 11, 12 |
| Error handling | 2 (Clerk failure), 6 (defer), 8 (no address), 10 (localStorage), 5 and 12 (non-admin settings) |
| Docs | 13 |

**Interfaces that cross tasks, and must match**

- `resolveMember()` → `{ org, member, isAdmin }`
- `canAct(ctx, ownerId)`, `assertAdmin(ctx)`, `NotOwnerError` / `AdminOnlyError`, `permissionErrorResponse`
- the owner lookups `get*OwnerId(orgId, id)` → `string | null | undefined`
- `mailboxOwnerFilter(orgId, ownerId)`
- `withSenderFields(lead, sender)`, `getCampaignSender(orgId, campaignId)`
- `resolveAlertRecipients(orgId, refs?)`
- `resolveView(isAdmin, param)`, `ownerFilterFor(view, memberId)`
- `assignOwner(orgId, entity, id, ownerId)`, `listMembers(orgId)`
- `getTeam`, `updateMember`, `updateTeamSettings`
