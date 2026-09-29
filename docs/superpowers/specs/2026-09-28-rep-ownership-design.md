# Rep Ownership — Design

**Date:** 2026-09-28
**Status:** Draft — awaiting review
**Scope:** Roadmap sub-project 3 (see `2026-09-23-microsoft365-autosend-design.md`). Campaigns and leads are owned by reps. Reps send from their own mailboxes and sign as themselves. Replies route to the owning rep. There are "Mine / Team" views and admin/rep permissions.

## Context

OutboundOS is used by a commercial snow and paving contractor with 2–5 reps. It will also be sold to other companies.

### Today

- **Nothing is owned.** Every lead, campaign, mailbox and draft belongs to the whole organization.
- **One escalation address.** Reply alerts and system alerts go to the single `Organization.escalationEmail` (`src/features/replies/server/notify.ts`, `deliver()`).
- **Unused member table.** `OrgMember` (clerkUserId, organizationId, role) exists in the schema, but nothing reads or writes it.
- **Roles are ignored.** Clerk Organizations already has roles (`org:admin`, `org:member`); the app doesn't check them.
- **Mailbox assignment has no owner concept.** `assignEnrollmentMailbox` picks the least-loaded active, healthy mailbox and pins it to the enrollment for the whole sequence.

### Decisions made during brainstorming

| Question | Decision |
|---|---|
| Goals | Replies go to the owning rep; emails are sent as the rep; "Mine / Team" views. (No territory assignment.) |
| How a lead gets an owner | From the campaign it's first enrolled in (the campaign owner); admins can reassign |
| Permissions | Everyone can see everything ("Team" view); reps act only on their own campaigns and leads; admins act on everything |
| Rep identity | A local `OrgMember` record per signed-in user, synced from Clerk on request |

### Success criteria

1. With mailboxes assigned, a rep's campaign emails leads only from that rep's mailboxes, and signs with the rep's name.
2. A reply from a rep's lead alerts that rep's escalation email; the admin is copied when "Copy admin on reps' replies" is on.
3. A rep can't edit, send, enroll, approve or pause anything they don't own. The server enforces this, not just the UI.
4. Before anything is assigned, sending, mailbox choice and alerts behave exactly as today.
5. Background jobs never depend on a Clerk API call.

## Scope

### In scope

- Member records and roles.
- Ownership fields and permission checks on every user write.
- Mailbox choice by owner, and the sender merge fields.
- Reply alert routing and the admin-copy setting.
- The "Mine / Team" toggle.
- Owner display and reassignment.
- Settings → Team, "My settings", and the one-time assignment banner.
- Updating the starter templates to sign with `{senderFirstName|}`.

### Out of scope

- Territories and round-robin assignment.
- Per-rep sending quotas.
- Per-rep analytics (beyond "Mine" filtering).
- Syncing owners to Salesforce (sub-project 4).
- Inviting users (Clerk's own UI handles invites).
- Deleting members.

## Design

### 1. Members and roles

**Data: `OrgMember` gains:**

| Field | Type | Notes |
|---|---|---|
| `name` | String? | From Clerk (first + last, or username) |
| `email` | String? | Clerk primary email |
| `escalationEmail` | String? | Where this rep's reply alerts go; null → `email` |
| `senderFirstName` | String? | For `{senderFirstName}` |
| `senderLastName` | String? | For `{senderName}` |
| `lastSeenAt` | DateTime? | Updated at most hourly |
| `role` | String | Existing column; values `'admin' \| 'member'` |

**Sync.**
- `resolveMember()` in `src/lib/auth/resolve-member.ts` reads `auth()` (`orgId`, `userId`, `orgRole`) and returns `{ org, member }`.
- It upserts the `OrgMember` row by `(clerkUserId, organizationId)` and maps the role: `org:admin` → `admin`, anything else → `member`.
- On first creation, or when `lastSeenAt` is older than an hour, it fetches the user from Clerk (`clerkClient().users.getUser`) to fill in `name` and `email`, and prefills the sender names from Clerk's first and last name when they're empty.
- It is used by every signed-in page and route in place of `resolveOrganization(orgId)`.
- **Removed users:** someone removed from the Clerk org can no longer sign into it, so their row stays for history (owner names on old campaigns) with no access.

**Permissions.** `canAct(member, ownerId)` in `src/features/team/permissions.ts` is pure: admins → true; members → `ownerId === member.id`.

| Action | Rule |
|---|---|
| Read any page / list | Every member |
| Create campaign | Every member; the creator becomes the owner |
| Edit, enroll into, pause, send from, approve sample of, override content for, placement-test a campaign or its sequences / variants / drafts | `canAct(member, campaign.ownerId)` |
| Change a lead's status, edit a lead, send its draft | `canAct(member, lead.ownerId)` |
| Import leads | Every member (imported leads start unowned) |
| Assign owners (campaign, lead, mailbox) | Admin |
| Settings (sending, business profile, mailboxes, deliverability actions, Team) | Admin |
| Own "My settings" (escalation email, sender names) | Every member for themselves; admins for anyone |

**Enforcement.**
- Each route that writes resolves the member, loads the owned entity's `ownerId` org-scoped, and returns **403 `{ code: 'NOT_OWNER', error }`** when `canAct` is false.
- Server functions keep taking `organizationId`. Checks live in routes (and server actions) through one helper, `assertCanAct`, that throws `NotOwnerError`.
- Unassigned items (`ownerId` null) are admin-only for writes.

### 2. Ownership data

| Model | Change |
|---|---|
| `Campaign` | + `ownerId String?` → `OrgMember` (`onDelete: SetNull`), index |
| `Lead` | + `ownerId String?` → `OrgMember` (`onDelete: SetNull`), index `(organizationId, ownerId)` |
| `Mailbox` | + `ownerId String?` → `OrgMember` (`onDelete: SetNull`) |
| `Organization` | + `copyAdminOnReplies Boolean @default(true)`, + `ownershipBannerDismissedAt DateTime?` |

**How owners get set:**
- A campaign is owned by the member who creates it (`createCampaign` gains `ownerId`).
- `enrollLead` sets `lead.ownerId = campaign.ownerId` when the lead has no owner. It never overwrites an existing owner.
- Existing rows start null ("Unassigned").

### 3. Sending as the rep

**Mailbox choice** (`assignEnrollmentMailbox`):
- The candidates are today's filters (active, not auto-paused, Graph for Microsoft 365 orgs, usable domain), further narrowed by owner:
  - **Campaign has an owner who owns at least one mailbox** (in any state): only the owner's mailboxes. If none of them passes the filters, return `null`; the runner defers and retries, as it does today when there's no usable mailbox.
  - **Campaign has an owner who owns no mailboxes:** shared mailboxes (`ownerId` null).
  - **Campaign has no owner:** shared mailboxes.
- Least-loaded choice and pinning are unchanged. Already-pinned enrollments keep their mailbox.
- **Manual send rotation** (non-sequence drafts in `sendDraft`) uses the same rule, keyed on the lead's owner.

**Sender merge fields.**
- `renderTemplate` gains `senderFirstName` and `senderName` (first + last), supplied from the campaign owner's member record. They're added to the render lead as reserved derived fields; real CSV columns with the same exact key still win (same precedence as `propertyType`).
- With no owner or no names set, the template's fallback is used.
- The content check treats them like other merge fields (fallback required).

**Starter templates.** Every step's closing "Thanks," becomes "Thanks,\n{senderFirstName|}". The copy-rules test still requires LOW and a fallback on every field. An empty fallback counts as present.

### 4. Reply routing

`deliver()` gains a recipient resolver: `resolveAlertRecipients(organizationId, { leadId?, mailboxId? })` returns `{ to: string, cc: string | null }`.

- **To:** the lead owner's `escalationEmail ?? email`, else the mailbox owner's `escalationEmail ?? email`, else `Organization.escalationEmail`.
- **Cc:** `Organization.escalationEmail` when `copyAdminOnReplies` is on and it differs from `to`.
- `notifyReply` passes the reply's `leadId` and `mailboxId`. `notifyUnmatchedReply` passes `mailboxId` only.
- **`sendOrgAlert` is unchanged:** system alerts go to the organization address only.
- `sendMailAsText` gains an optional `cc` (Graph `ccRecipients`).
- **No address at all:** the existing warning and `false` return.

### 5. Views and admin screens

**The "Mine / Team" toggle.** A shared `ViewToggle` client component writes `?view=mine|team` and remembers the last choice in `localStorage` (wrapped in try/catch).
- Server pages read `searchParams.view`. The default is `mine` for members and `team` for admins.
- **Filters:**
  - Leads and Pipeline: `lead.ownerId = me`
  - Campaigns: `campaign.ownerId = me`
  - Sequences and Drafts: through `campaign.ownerId = me`
  - Inbox and Replies: `lead.ownerId = me`, or unmatched items on my mailboxes
  - Dashboard: counts under the same filters

**Owner display.** An **Owner** column or badge on the Leads, Campaigns and Inbox lists ("Unassigned" when null). The campaign and lead pages show the owner, plus an admin-only **Owner** select. Reassigning a campaign doesn't move pinned enrollments.

**Settings → Team** (new section):
- A members table: name, role, email, escalation email, sender name, number of mailboxes, last seen.
  - Admins edit any row's escalation email and sender names.
  - Roles are changed in Clerk. The table says so and links to Clerk's organization profile.
- The **"Copy admin on reps' replies"** toggle.
- The existing **mailboxes list** gains an admin-only **Owner** select.
- **"My settings"** is available to every member: their own escalation email and sender names.

**Assignment banner.** Admins see "Assign existing campaigns and mailboxes to reps" on the dashboard while any campaign or mailbox has no owner and the banner isn't dismissed. It links to Campaigns (Team view) and Settings → Team. It's dismissible (`ownershipBannerDismissedAt`).

### Data model changes (one migration)

| Model | Change |
|---|---|
| `OrgMember` | + `name`, `email`, `escalationEmail`, `senderFirstName`, `senderLastName`, `lastSeenAt`; relations to owned campaigns, leads and mailboxes |
| `Campaign`, `Lead`, `Mailbox` | + `ownerId String?` (SetNull), indexes |
| `Organization` | + `copyAdminOnReplies Boolean @default(true)`, `ownershipBannerDismissedAt DateTime?` |

## Error handling

| Failure | Behavior |
|---|---|
| Rep acts on another rep's item | 403 `NOT_OWNER`; the UI hides or disables the control, but the server is authoritative |
| Clerk user fetch fails during sync | Keep existing name/email (or null); the request proceeds; retried next hour |
| Owner has mailboxes but none usable | Enrollment defers (as today with no mailbox); shown on Deliverability as usual |
| Owner removed from Clerk | Their row stays; admins reassign; alerts to them still use the stored escalation email until reassigned |
| No recipient address at all | Existing warning; alert skipped (`false`), as today |
| `localStorage` unavailable | Toggle still works via `?view=`; the default applies |

## Testing

- **resolveMember:** creates / updates a row, role mapping, hourly Clerk refresh, Clerk failure tolerated, org-scoped.
- **canAct:** admin, owner, non-owner, unassigned; `assertCanAct` → `NotOwnerError`.
- **Every write route:** a table-driven test per route family (campaigns, sequences / variants / enroll, drafts, leads, placement test, content override) — non-owner member → 403 `NOT_OWNER`, owner → allowed, admin → allowed.
- **Settings routes:** admin-only; "My settings" self-only for members.
- **Ownership:** campaign create sets the owner; enroll sets the lead owner only when empty.
- **Mailbox choice:** owner's mailboxes only; owner with none → shared; owner's all unusable → null; unowned campaign → shared; pinned untouched.
- **Manual send rotation** by lead owner.
- **Sender merge fields:** render with and without owner names; fallback; CSV-key precedence. The starter templates still pass the copy rules.
- **Reply routing:** lead owner → mailbox owner → org fallback chain; CC rules (on/off, same address); `sendOrgAlert` unchanged; `cc` reaches Graph.
- **Views:** the default per role; the filters per page (server functions take `ownerId?`).
- **UI:** toggle, owner selects (admin only), Team settings, My settings, banner visibility/dismissal.

## Open risks

1. **Many routes to guard.** A missed route is a silent permission hole. The plan enumerates every write route, and a test asserts each returns 403 for a non-owner.
2. **Members must sign in once** before they can own anything or receive alerts. The Team table shows who has.
3. **Existing sequences keep their mailbox** after reassignment, which is correct for threading but can surprise. The owner dropdown says "Existing sequences keep sending from their current mailbox."
4. **Clerk role changes** take effect on the member's next request (the role is mirrored on each request).
