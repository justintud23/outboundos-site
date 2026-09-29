# Salesforce sync: design

Roadmap item 4. Salesforce stays the system of record; OutboundOS does the outreach. The approach is approach A: a direct integration using one org-wide OAuth connection, with a durable sync queue.

## Goals

1. **Pull leads in.** A rep imports a Salesforce Lead or Contact list view into OutboundOS.
2. **Log activity.** Every send and reply is logged as a Salesforce Task on the matching record. A prospect who isn't in Salesforce yet gets a Salesforce Lead created when they first reply, and the whole thread is then logged to it.
3. **Don't email customers.** Before import and before every send, skip anyone Salesforce says is opted out, a customer, has an open opportunity, or is a converted lead.

**Non-goals:**
- pushing interested replies to Opportunities
- per-rep Salesforce logins
- custom-field mapping
- scheduled or automatic pulls
- HubSpot

## Constraints

- Official OAuth and REST APIs only. No scraping, and no stored user passwords. The app will be sold to other companies.
- It must work without knowing the customer's edition. We don't assume Enhanced Email, Person Accounts or custom fields.
- There are no new paid services. Build and test against a free Salesforce Developer Edition.
- Salesforce being down or disconnected must never block or slow sending, apart from the "customer check" hold rule below. It must also never cause an email to a blocked person.
- When Salesforce is not connected, behavior is identical to today.

## 1. Connection

**App registration:** one External Client App owned by us.
- Scopes: `api refresh_token id`.
- Callback: `${NEXT_PUBLIC_APP_URL}/api/integrations/salesforce/callback`.
- New env vars: `SALESFORCE_CLIENT_ID`, `SALESFORCE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (32 bytes, base64).
- If the Salesforce vars are missing, the Salesforce settings card shows "Salesforce isn't configured on this server" and nothing else changes.

**Connecting (admin-only):**
1. Settings → Salesforce → **Connect Salesforce**, with an environment choice: Production (`login.salesforce.com`) or Sandbox (`test.salesforce.com`).
2. `GET /api/integrations/salesforce/connect?env=production|sandbox` redirects to the authorize URL using OAuth 2.0 web-server flow with PKCE (S256).
   - `state` is an HMAC-signed payload `{orgId, memberId, env, nonce, exp (10 min)}`.
   - The PKCE verifier is kept in an httpOnly, SameSite=Lax cookie scoped to the callback path.
3. `GET /api/integrations/salesforce/callback`:
   - Verifies the state signature, its expiry, and that it names the current Clerk org.
   - Requires an admin.
   - Exchanges the code, calls the `id` URL for user, org and email, and upserts the connection.
   - Redirects to `/settings?salesforce=connected`, or `?salesforce=error&reason=<code>` on failure.
4. **Disconnect** (`DELETE /api/integrations/salesforce`, admin): revokes the token at `/services/oauth2/revoke` (best effort), then deletes the connection row. Queued jobs stay and resume if it reconnects.

**Data (`salesforce_connections`, one row per org):**
- `organizationId` (unique), `instanceUrl`, `loginHost`, `sfOrgId`, `sfUserId`, `sfUsername`, `sfUserEmail`
- `refreshTokenEnc`
- `status` enum `CONNECTED | NEEDS_RECONNECT | RATE_LIMITED`, plus `lastError` and `rateLimitedUntil`
- `customerAccountTypes` String[] (default `['Customer']`), `blockOpenOpportunities` (default true), `logActivity` (default true)
- `connectedAt`, `connectedByMemberId` (SetNull)

**Token encryption:** `src/lib/crypto/token-cipher.ts`. AES-256-GCM with a random 12-byte IV, stored as `v1:<iv>:<tag>:<ciphertext>` in base64.

**Access tokens:** cached in memory per org, refreshed on demand or on a 401.
- An `invalid_grant` on refresh sets `NEEDS_RECONNECT` and records `lastError`.
- It also sends one `sendOrgAlert` ("Salesforce disconnected, reconnect in Settings"). No repeat alert while the status is unchanged.

## 2. Salesforce client

`src/features/salesforce/server/client.ts` is the only code that talks to Salesforce. It uses API version `v62.0`.

**Methods:** `query(soql)` (follows `nextRecordsUrl`), `listViews(sobject)`, `listViewResults(sobject, id, {limit, offset})`, `create(sobject, fields)`, `identity()`.

**SOQL escaping:** all values in SOQL go through an escape helper for quotes and backslashes. Email lists are chunked at 200 values per `IN`.

**Errors:** `SalesforceAuthError` (needs reconnect), `SalesforceRateLimitError`, and `SalesforceApiError { status, errorCode, message }`, which carries Salesforce's message, e.g. `REQUIRED_FIELD_MISSING`.

**Usage limits:** reads the `Sforce-Limit-Info: api-usage=N/M` header.
- At ≥80%, set `RATE_LIMITED` with `rateLimitedUntil` = the next UTC midnight, and alert once.
- While rate-limited, sync jobs pause. The pre-send check follows the "unreachable" rule.

**Owner matching:** `resolveSfUserId(orgId, ownerMemberId)` finds an active Salesforce User by the member's email, cached per org for 1 hour. It falls back to the connected user's id.

## 3. Pulling leads in

**UI:** Leads page → **Import from Salesforce**. Shown to members and admins when connected.
1. Choose an object: Lead or Contact.
2. Choose a list view. This lists the views the connected user can see.
3. Preview: the first 25 rows and the total count.
4. Import. An admin also sees a checkbox, "Use Salesforce owners where they match a rep".

**Routes:**
- `GET /api/salesforce/list-views?object=Lead|Contact`
- `GET /api/salesforce/list-views/[id]/preview?object=`
- `POST /api/salesforce/import { object, listViewId, useSalesforceOwners? }`

Each returns `{ code: 'NOT_CONNECTED' }` 409 when not connected.

**Import (`import-list-view.ts`):**
- **Fetching:** up to `MAX_SF_IMPORT = 2000` records in pages of 200. Then re-query the ids for full fields.
  - Lead: `Id, FirstName, LastName, Email, Company, Title, Phone, State, Country, PostalCode, HasOptedOutOfEmail, IsConverted, OwnerId, Owner.Email`
  - Contact: `Id, FirstName, LastName, Email, Title, Phone, MailingState, MailingCountry, MailingPostalCode, HasOptedOutOfEmail, AccountId, Account.Name, Account.Type, OwnerId, Owner.Email`
  - For Contact accounts, check open opportunities with one query per 200 AccountIds: `SELECT AccountId FROM Opportunity WHERE IsClosed = false AND AccountId IN (...)`.
- **Mapping:** name, email (lower-cased), company (Lead.Company or Account.Name), title, phone.
  - `country`, normalized as the CSV import does. State goes in `customFields.state` (also read by scoring).
  - ZIP goes in `customFields.zip` (one of the keys business-profile scoring reads in `lead-facts.ts`).
- **Blocking:** run the classification from §5 on each record. Blocked records are not imported and are counted by reason. Records without an email are skipped (`noEmail`).
- **Existing lead with the same email in the org:**
  - Set the `salesforceId/Type/AccountId` link if it's empty.
  - Fill only null fields. Never overwrite.
  - Don't change the owner.
  - Count it as `linked`.
- **New lead:**
  - `source = SALESFORCE`, `importBatchId` → a new `ImportBatch` with `fileName = "Salesforce: <list view name>"`.
  - `ownerId` = the importing member, unless the admin chose Salesforce owners and `Owner.Email` matches an OrgMember email in the org.
- **Response:** `{ imported, linked, skipped: { customer, openOpportunity, optedOut, converted, noEmail, invalid } }`. The UI shows it, e.g. "12 skipped: 8 customers, 3 opted out, 1 no email".
- **Afterwards:** new leads go through the same scoring and verification hooks the CSV import triggers.
- **Duration:** runs within one request with `maxDuration = 60`. 2,000 records is about 12 API calls.

**Lead fields (migration):**
- `salesforceId String?`, `salesforceType SalesforceObject?` (enum `LEAD | CONTACT`), `salesforceAccountId String?`
- `sfCheckStatus SfCheckStatus?` (enum `CLEAR | CUSTOMER | OPEN_OPPORTUNITY | OPTED_OUT | CONVERTED | NOT_FOUND`), `sfCheckedAt DateTime?`, `sfCheckDetail String?` (e.g. the account name)
- `sfBlockOverride Boolean @default(false)`, `sfHeldSince DateTime?`
- `@@index([organizationId, salesforceId])`

## 4. Activity logging

**Job table (`salesforce_sync_jobs`):**
- `id`, `organizationId`, `leadId`
- `type` enum `LOG_SEND | LOG_REPLY | CREATE_LEAD`
- `outboundMessageId?` and `inboundReplyId?` (FKs, Cascade)
- `status` enum `PENDING | DONE | FAILED`
- `attempts Int`, `nextAttemptAt`, `lastError?`, `sfTaskId?`, `createdAt`, `updatedAt`
- `@@unique([type, outboundMessageId])`, `@@unique([type, inboundReplyId])`, `@@index([status, nextAttemptAt])`

**Enqueueing** (only when the org is connected and `logActivity` is on), using `createMany … skipDuplicates`:
- After an OutboundMessage is marked SENT (send-draft and send-queue paths), enqueue `LOG_SEND`. This applies only if the lead has a `salesforceId`.
- After an InboundReply is matched to a lead, enqueue `LOG_REPLY`. If the lead has no `salesforceId`, enqueue `CREATE_LEAD` (keyed on the reply) instead.

**Processing:** `processSalesforceJobs({ limit: 50 })` runs inside the existing `sequence-runner` cron, after its current work, in a try/catch that never fails the cron.
- Pick `PENDING` jobs with `nextAttemptAt <= now` whose org is `CONNECTED`. Skip orgs that are `NEEDS_RECONNECT`, or `RATE_LIMITED` until the limit expires.
- `LOG_SEND` / `LOG_REPLY`: create a Task with:
  - `WhoId` = salesforceId, `Subject` = `Email: <subject>` or `Reply: <subject>` (truncated to 255)
  - `Description` = the plain-text body (truncated to 32,000)
  - `Status = 'Completed'`, `Priority = 'Normal'`, `TaskSubtype = 'Email'`, `ActivityDate` = the send or receive date
  - `OwnerId` = `resolveSfUserId(lead.ownerId)`
- `CREATE_LEAD`:
  - Search by email first: Contact, then an unconverted Lead.
  - If found, link it. If not, create a Lead with `FirstName, LastName` (fallback: the email local part, since LastName is required), `Company` (fallback `"Unknown"`, since it's required), `Email, Title, Phone, LeadSource = 'OutboundOS'`, and `OwnerId` from matching.
  - Then set the link on the OutboundOS lead and enqueue `LOG_SEND` for every past SENT message and `LOG_REPLY` for every reply, with skipDuplicates.
- **Retries:** a failure sets `attempts++`. Backoff by attempt: 5 min, 30 min, 2 h, 12 h, 12 h. After 6 attempts the job is `FAILED`.
  - `SalesforceAuthError` / `SalesforceRateLimitError` don't consume an attempt. They set the connection status.
  - `SalesforceApiError` stores `lastError = "<errorCode>: <message>"`.
- **Manual retry:** `POST /api/salesforce/jobs/[id]/retry` (admin) resets to `PENDING` with attempts 0.

## 5. Pre-send check

**Classification** (a pure function, `classifySfRecord`), in priority order:
1. `OPTED_OUT`: `HasOptedOutOfEmail`.
2. `CONVERTED`: a Lead with `IsConverted`.
3. `CUSTOMER`: a Contact whose `Account.Type` is in `customerAccountTypes` (case-insensitive).
4. `OPEN_OPPORTUNITY`: `blockOpenOpportunities` is on and the Contact's Account has an open Opportunity.
5. Otherwise `CLEAR`.

When an email matches several records, the most restrictive wins. An email with no match is `NOT_FOUND`, which counts as clear.

**`ensureSalesforceClear(orgId, leadIds): Promise<{ allowed: Set<string>, held: Set<string>, blocked: Set<string> }>`:**
- Not connected → all allowed.
- Leads with `sfBlockOverride` → allowed.
- Leads with `sfCheckedAt` under 24h old → decided from the stored status.
- The rest are looked up by email in one batch: Leads and Contacts, `IN` chunks of 200, plus the opportunity query. The results are stored on the leads.
- If the lookup fails (auth, rate limit, network, 5xx):
  - Leads with a check under 7 days old are decided from the stored status.
  - Others are `held`.
- Blocked means status ∈ {OPTED_OUT, CONVERTED, CUSTOMER, OPEN_OPPORTUNITY} and no override.

**Call sites:**
- **Sequence runner:** before generating or sending a step, for the batch of due enrollments.
  - Blocked → stop the enrollment (`STOPPED`, `stoppedReason = 'Salesforce: <status> (<detail>)'`), and set any PENDING_REVIEW/APPROVED unsent draft for the lead to `BLOCKED`.
  - Held → skip this run without changing state.
- **Send queue cron and `send-draft` (manual send):** check the lead first.
  - Blocked → the draft becomes `BLOCKED` and a `LeadBlockedBySalesforceError` is surfaced (422 on the manual route).
  - Held → the send stays queued (cron), or the manual route returns 503 "Couldn't check Salesforce; try again shortly".
- **Import:** see §3.

**Held alert:** if any lead in an org has been held for more than 24h (tracked with `sfHeldSince` on the lead, cleared once decided), send one `sendOrgAlert` per day.

**Lead page:**
- Shows a Salesforce badge: a link to `<instanceUrl>/<salesforceId>` and the last check status.
- For a blocked lead it shows the reason. Admins get an **Allow anyway** button that sets `sfBlockOverride` (`POST /api/leads/[id]/salesforce-override`, admin).

## 6. Settings UI

**Settings → Salesforce card** (admins see the controls; members see the status only):
- Not configured / not connected: the connect button and the environment choice.
- Help text: connect with a user that has API access, ideally a dedicated integration user; ask IT which edition you have and to allow the app.
- Connected:
  - "Connected as <username> (<org>)" and **Disconnect**
  - customer Account Types (a comma-separated input)
  - an open-opportunity toggle and an activity-logging toggle
- Health:
  - last 24h counts: synced, pending, failed
  - the last 10 failed jobs, each with its error and **Retry**
- `NEEDS_RECONNECT` / `RATE_LIMITED` banner.

**Route:** `PATCH /api/integrations/salesforce/settings` (admin), validated with zod.

## 7. Permissions

- **Admin-only:**
  - connect, callback, disconnect and settings
  - job retry
  - the block override
  - the "use Salesforce owners" import option
- **Any member:** list views, preview, and import. Imported leads are owned by the importer.
- The existing ownership rules apply to everything downstream.

## 8. Errors and edge cases

- An import while `NEEDS_RECONNECT` returns 409 with a "Reconnect Salesforce in Settings" message.
- List view results that return no `Email` column: we re-query by Id, so list view columns don't matter.
- A deleted Salesforce record (`ENTITY_IS_DELETED` / `NOT_FOUND` on a Task create):
  - Clear the lead's link.
  - Convert the job to `CREATE_LEAD` if it's a reply, otherwise mark it `FAILED` with the error.
- A lead's email changes in OutboundOS: nothing is re-linked automatically.
- A connection to a different Salesforce org (a different `sfOrgId`) on reconnect:
  - Clear all lead links and check results for the org.
  - Warn in the confirmation: "This is a different Salesforce org; existing links will be cleared."

## 9. Testing

- **Unit tests** with a mocked `fetch` or client:
  - token cipher round-trip and tamper detection
  - state signing and expiry
  - callback org mismatch and non-admin rejection
  - client limit-header handling and error mapping, SOQL escaping
  - `classifySfRecord`: every rule and precedence
  - `ensureSalesforceClear`: fresh cache, stale lookup, failure within and beyond 7 days, override, not connected
  - import mapping, duplicate linking, skip counts and owner options
  - job processing: Task fields, `CREATE_LEAD` search-then-create, backoff, auth and rate-limit pausing, no double-enqueue
  - call sites: the sequence runner stops blocked leads, the send queue holds, manual send returns 422/503
- **Manual end-to-end** on a Salesforce Developer Edition (the user creates it), before merge:
  1. Connect it.
  2. Import a Lead list view and a Contact list view.
  3. Send to a test inbox and reply.
  4. Verify the Tasks, and a new Lead for the CSV-sourced lead.
  5. Mark an Account `Type = Customer` and confirm the next step is blocked.
  6. Revoke the app, and confirm `NEEDS_RECONNECT` and the alert.

## 10. Docs

**README "## Salesforce" section:**
- env vars and the External Client App setup (callback URL, scopes)
- who connects
- the IT questions (edition and API access, app approval)
- what is logged, what is blocked, and how the hold rule works
