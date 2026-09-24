# OutboundOS

**Outbound sales automation that tells you what to do next — and lets you do it.**

Most outbound tools show you dashboards. OutboundOS shows you the next best action, explains why, and lets you execute it without leaving the page.

**[Live Demo](https://outboundos-site.vercel.app)**

---

## Screenshots

### Dashboard
KPI summary, activity charts, and a live Action Center that surfaces the highest-priority work.

![Dashboard](./public/screenshots/dashboard.png)

### Lead Command Center
Everything about a single lead in one place — timeline, messages, next actions, sequence progress. Execute inline without navigating away.

![Lead Command Center](./public/screenshots/lead-command-center.png)

### Action Center
Prioritized, reasoned actions across your entire pipeline. Each action explains *why* it matters and *how urgent* it is.

![Action Center](./public/screenshots/action-center.png)

### Inbox
Threaded conversation view with reply classification and quick access to lead details.

![Inbox](./public/screenshots/inbox.png)

### Pipeline
Drag-and-drop Kanban board showing every lead by status, with scores and last activity.

![Pipeline](./public/screenshots/pipeline.png)

### Analytics
Funnel metrics, campaign performance, reply classification breakdown, and daily activity trends.

![Analytics](./public/screenshots/analytics.png)

---

## What Makes This Different

### 1. Decision Engine (Action Center)
The system continuously scans your pipeline — pending drafts, unread replies, stale leads, interested prospects — and generates a prioritized action queue with reasoning and urgency indicators. It's not a notification list; it's a decision engine.

### 2. Execution Layer (Inline Actions)
Actions aren't just suggestions. From the Lead Command Center, you can approve drafts, send emails, and convert leads directly — with optimistic UI, ghost success states, and undo capability. The interface feels instant because it is.

### 3. Lead Command Center
A single-lead detail page inspired by Linear and HubSpot. Unified timeline (emails, replies, status changes, sequence steps), thread-style messages, sequence progress, and the filtered action queue for that specific lead.

---

## Core Features

**Lead Management**
- CSV import with validation
- AI-powered lead scoring (0-100) with reasoning
- Pipeline board with drag-and-drop status management
- Full status lifecycle with automatic transition rules

**Outbound Automation**
- AI draft generation with prompt versioning
- Human-in-the-loop approval workflow
- Multi-step email sequences with enrollment management
- SendGrid integration with daily send limits and event tracking

**Reply Intelligence**
- Automatic reply classification (Positive, Negative, Out of Office, Unsubscribe, Referral)
- Classification confidence scoring
- Automatic lead status transitions based on reply sentiment

**Decision Engine**
- Prioritized next-best-action queue
- Time-decay urgency messaging
- Per-lead action filtering
- Inline execution with optimistic UI and undo

**Analytics**
- Funnel conversion metrics (Sent → Delivered → Opened → Replied → Interested)
- Campaign performance comparison
- Reply classification breakdown
- Daily activity trends with date range controls

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript (strict) |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL (Neon) + Prisma v7 |
| Auth | Clerk (multi-tenant Organizations) |
| AI | OpenAI (gpt-4o) |
| Email | SendGrid |
| Testing | Vitest + React Testing Library |
| Deployment | Vercel |

---

## Architecture

```
src/
├── app/(dashboard)/       # Thin route pages (server components)
├── features/              # Feature modules
│   ├── leads/             # Lead management + Command Center
│   │   ├── server/        # Business logic (org-scoped queries)
│   │   └── components/    # UI components
│   ├── actions/           # Decision engine
│   ├── drafts/            # Draft generation + approval
│   ├── sequences/         # Multi-step sequences
│   ├── inbox/             # Threaded conversations
│   ├── analytics/         # Metrics + charts
│   └── dashboard/         # Dashboard modules
├── components/ui/         # Design system (Button, Badge, StatCard, etc.)
├── components/layout/     # Sidebar, Header, Navigation
└── lib/                   # Auth, DB, AI, Email utilities
```

**Key architectural decisions:**
- Business logic lives in `features/*/server/` — pages stay thin
- All queries are organization-scoped via `resolveOrganization()`
- Server-driven pages with client components for interactions
- Optimistic UI with server revalidation as source of truth

---

## Local Development

```bash
git clone https://github.com/justintud23/outboundos-site.git
cd outboundos-site
npm install
cp .env.example .env    # Fill in your keys
npx prisma migrate dev
npx prisma db seed      # Populate demo data
npm run dev
```

### Environment Variables

```env
DATABASE_URL=                        # pooled connection — app runtime
DIRECT_URL=                          # direct (non-pooled) connection — Prisma CLI migrations (Neon: non-pooler host)
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
SENDGRID_WEBHOOK_VERIFICATION_KEY=   # ECDSA public key from SendGrid; verifies signed event webhooks (unset = verification skipped, dev only)
UNSUBSCRIBE_TOKEN_SECRET=            # secret for signing one-click unsubscribe tokens (RFC 8058 List-Unsubscribe); any long random string
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Capture Screenshots

```bash
SCREENSHOT_EMAIL=you@example.com SCREENSHOT_PASSWORD=yourpass npx tsx scripts/capture-screenshots.ts
```

---

## Testing

```bash
npm test              # Run all 250+ tests
npm test -- --watch   # Watch mode
```

Tests cover server functions (business logic, edge cases, org isolation) and UI components (rendering, interactions, state management).

---

## Microsoft 365 Sending Setup

Automated outbound email requires a dedicated Microsoft 365 tenant with sending mailboxes, application permissions, and an external scheduler.

### Operational Setup

1. **Buy domains:** 3 lookalike sending domains, e.g. `get<company>.com` and `<company>snow.com`. Point each domain's website at the main company site.
2. **Create the tenant:** a new Microsoft 365 tenant, with the domains added and verified.
3. **DNS:** SPF, DKIM (enabled in Defender), and DMARC (`p=none` to start) on every domain.
4. **Mailboxes:** 2–3 licensed mailboxes per domain, 7 total to start, with realistic names. Outlook signatures are **not** applied to mail sent through Microsoft Graph — put the signature in your sequence templates instead.
5. **Grant access:** give the user Full Access and Send As on every sending mailbox so they auto-map in Outlook. Then, in **Exchange Online PowerShell**, make every sending mailbox keep a copy of what is sent as/on behalf of it — OutboundOS detects that you've already handled a reply by looking for your answer in the sending mailbox's Sent Items:
   ```powershell
   Set-Mailbox <mailbox> -MessageCopyForSentAsEnabled $true -MessageCopyForSendOnBehalfEnabled $true
   ```
   Run it once for each sending mailbox.
6. **Notifications mailbox:** create the shared mailbox for notifications.
7. **App registration:** 
   - Register an app in **Entra ID > App registrations**.
   - Redirect URI: `https://<app>/api/integrations/microsoft/callback` (Web).
   - Grant application permissions: `Mail.Send`, `Mail.ReadWrite`, `User.Read.All`.
   - Click **Grant admin consent** to approve these permissions for the entire tenant.
   - Copy the **Directory (tenant) ID** from the app's Overview page into `MS_GRAPH_TENANT_ID`. OutboundOS only accepts a Microsoft 365 connection from this tenant; connecting is refused while it is unset.
   - Create a mail-enabled security group "Sending Mailboxes" containing all sending mailboxes and the alerts shared mailbox.
   - In **Exchange Online PowerShell**, run:
     ```powershell
     New-ApplicationAccessPolicy -AppId <MS_GRAPH_CLIENT_ID> -PolicyScopeGroupId sending-mailboxes@<domain> -AccessRight RestrictAccess -Description "OutboundOS"
     ```
   - Verify it with:
     ```powershell
     Test-ApplicationAccessPolicy -Identity mike@<domain> -AppId <MS_GRAPH_CLIENT_ID>
     ```
8. **Scheduler:** Set up three **cron-job.org** jobs, each running every 5 minutes with method `GET` and header `Authorization: Bearer <CRON_SECRET>`:
   - `https://<app>/api/cron/sequence-runner`
   - `https://<app>/api/cron/send-queue`
   - `https://<app>/api/cron/inbox-monitor`
   
   Enable **"notify on failure"** on all three jobs. The send-queue and inbox-monitor jobs deliberately return HTTP 503 when Microsoft 365 rejects OutboundOS (expired client secret, revoked consent — sending is paused) or mailboxes fail to poll, because the in-app alert email can't get out through the same broken credentials; cron-job.org's failure email is the alert. cron-job.org auto-disables a job after repeated failures: once you've fixed the cause (and resumed sending in Settings), re-enable any job it disabled.
9. **Warmup:** Plan 2–4 weeks before full volume. The app's warmup ramp starts low automatically. A peer-warmup service is recommended during this period.

### In-App Setup

Once infrastructure is in place:

1. **Settings → Connect Microsoft 365** — click the admin consent link to authorize the app for your tenant.
2. **Load mailboxes** — the app lists available mailboxes; import the sending ones.
3. **Configure defaults:**
   - Set escalation email (where replies are forwarded).
   - **Set business name and mailing address — required.** CAN-SPAM requires a physical postal address (a USPS-registered PO box is fine) in every commercial email; the app adds it to every email's footer and **blocks all sending until it is set**.
   - Set timezone and business hours (default 08:00–17:00, Mon–Fri).
   - Leave **Allow Canadian recipients** off. Canada's anti-spam law (CASL) requires consent even for B2B email, so leads that look Canadian (country/province column, `.ca` email, or Canadian phone area code) are never enrolled or emailed and are labelled *Excluded: Canada (CASL)* on the Leads page. Turn it on only if you have documented consent.
4. **Create a campaign** and add a multi-step sequence.
5. **Enroll leads** from your CSV. Extra columns (city, state, country, lot count, …) are kept on each lead and usable as `{city}`-style merge fields.
6. **Turn on auto-send** for the campaign. The app generates a sample batch of 10 drafts.
7. **Approve the sample** — review personalization and guardrail flags. Once approved, the sequence runs automatically.

### Writing Templates

**Merge fields:**
Use `{fieldName}` for lead attributes. If a field is missing, provide a fallback:
```
{company|your company}
```

**Personalization marker:**
Include `{personalization}` where the AI will insert 1–2 sentences tailored to the lead:
```
Hi {firstName|friend},

{personalization}

Would you be interested in learning more?
```

**Guardrails:**
The system blocks sends containing:
- Currency amounts (`$` followed by digits)
- The words "guarantee", "guaranteed", or "free"
- Any org-configured blocked phrase

**Exemptions:**
- Words listed under **Always-allowed words** (Settings) bypass the rule.
- Any phrase that appears verbatim in your approved template is exempt.

---

## Deliverability

The **Deliverability** page (available only when Microsoft 365 is connected) monitors domain health, enforces sending ramps, and protects your reputation through automated checks and alerts.

### Ramp Presets

Email warming is built in. Every mailbox starts with a conservative ramp that gradually increases daily send volume over 29 days. Change the preset per mailbox on the Deliverability page (changing it keeps the current ramp day); **Restart ramp** there sends a mailbox back to day 1:

| Ramp Day | Conservative | Standard | Aggressive |
|----------|--------------|----------|-----------|
| 1–3 | 3/day | 5/day | 10/day |
| 4–7 | 5/day | 10/day | 18/day |
| 8–14 | 10/day | 18/day | 25/day |
| 15–21 | 18/day | 25/day | full |
| 22–28 | 25/day | full | full |
| 29+ | full | full | full |

"Full" means the mailbox's daily limit. Turning off the ramp gives you the full limit immediately, but young domains (registered < 30 days ago) are still capped at 10/day until they age.

### Domain Health Checks

Outbound mail is queued until your domains pass verification. Checks run on import, daily (at 16:00 UTC), and on demand via **Recheck now** (limited to once per 60 seconds per domain). A domain fails if **any** check fails; queued mail waits and is never lost.

**SPF:** Must include `spf.protection.outlook.com` and end with `-all` (reject) or `~all` (softfail).

**DKIM:** Both Microsoft 365 CNAME records must exist in DNS, and DKIM must be enabled in **Microsoft Defender → Email authentication → DKIM**.

**MX:** Must resolve to `*.mail.protection.outlook.com`.

**DMARC:** Recommended but only warns; a missing or failing DMARC record does not block sending.

**Young domain rule:** Domains registered less than 30 days ago (or with unknown registration dates from the registry) are capped at 10 sends per day regardless of the mailbox ramp. Update the registration date on the page if RDAP doesn't find it.

### Alerts

You receive one email when a domain **starts failing** checks and one email when it **recovers**. Alerts are sent from `MS_NOTIFY_MAILBOX` to the organization's escalation email.

### What We Don't Do

OutboundOS does not automate opens, replies, or spam rescue — that violates Google's and Microsoft's terms. Warmup here means careful real sending: a slow volume ramp on correctly authenticated domains, with bounce and complaint monitoring.
