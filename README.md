# OutboundOS

**AI-powered outbound sales automation — multi-tenant SaaS with reply intelligence, analytics, and email orchestration.**

---

## Overview

OutboundOS is a full-stack SaaS platform for managing outbound email campaigns. Each organization gets isolated campaign management, AI-generated and human-reviewed email drafts, real-time delivery analytics, AI-classified inbound replies, and a customizable prompt template system — all scoped to their tenant by Clerk organization membership.

Built as a portfolio project demonstrating production-grade architecture patterns: feature-oriented modules, multi-tenant data isolation, AI abstraction layers, and event-driven analytics.

---

## Features

### Campaigns
- Campaign list with summary cards (Total / Sent / Pending Drafts / Replies)
- Per-campaign stats: messages sent, drafts in review, inbound reply count
- Status badges: Draft, Active, Paused, Completed, Archived
- **Campaign Detail page** (`/campaigns/[id]`):
  - 5 stat cards: Messages Sent, Total Drafts, Pending Review, Replies, Positive
  - Pending-draft CTA banner (amber) when drafts are awaiting review
  - Drafts section: lead context, subject, status badge, created date
  - Replies section: classification badge, confidence %, body preview, received date
  - All data fetched in a single parallel `Promise.all` — no N+1 queries

### Draft Review Flow
- AI-generated email drafts queued for human review
- Filter tabs: All / Pending / Approved — with live badge counts
- Amber pending-review banner: "N drafts pending review → Review now"
- Right-side review drawer with:
  - Lead context panel (name, email, company)
  - "✦ AI Generated" indicator when a prompt template was used
  - Editable subject and body — edits saved on approve
  - "Edited — will save on approve" hint when changes are detected
  - Approve / Reject (with optional rejection reason)
- Approved drafts stay in list for one-click Send
- Sent drafts removed immediately from the queue

### Reply Intelligence
- Ingest inbound replies via SendGrid Inbound Parse
- AI-classify replies into: `POSITIVE`, `NEUTRAL`, `NEGATIVE`, `OUT_OF_OFFICE`, `UNSUBSCRIBE_REQUEST`, `REFERRAL`, `UNKNOWN`
- Link replies to originating outbound message via `sgMessageId` correlation
- Custom prompt templates per organization (with fallback defaults)

### Analytics Dashboard
- 8 KPI cards: Sent, Delivered, Opened, Clicked, Replies, Positive Replies, Bounced, Unsubscribes
- Deduplication-aware event counting (one message = one delivered/opened/clicked, not one per event row)
- Computed delivery, open, click, bounce, and positive reply rates

### Replies Table
- Full reply history with sender, classification badge, and timestamp
- Client-side classification filter (All / per-class)
- Visual highlighting for `POSITIVE` rows
- Distinct badge styles for `UNSUBSCRIBE_REQUEST` and `OUT_OF_OFFICE`

### Leads
- Lead table: name, email, company, title, status badge, AI score, source
- Status badges: New, Contacted, Replied, Bounced, Unsubscribed, Converted

### Prompt Template System
- Per-org custom prompt templates for reply classification
- Active/inactive toggle — falls back to system default when none active
- Prompt type scoped (`REPLY_CLASSIFICATION`)

### Multi-Tenant Auth
- Clerk Organizations as tenant boundary
- All Prisma queries scoped to internal `Organization.id` (Clerk orgId never used as FK)
- `resolveOrganization()` as the single translation point

---

## Architecture

```
src/
├── app/                    # Next.js App Router — pages and API routes
│   ├── (dashboard)/        # Authenticated dashboard layout
│   │   ├── campaigns/      # Campaigns page (server component)
│   │   ├── drafts/         # Drafts page + DraftsClient (state)
│   │   ├── analytics/      # Analytics dashboard
│   │   ├── replies/        # Replies table
│   │   └── leads/          # Leads table
│   └── api/                # Thin route handlers (no business logic)
│       └── drafts/[id]/    # review (PATCH) + send (POST)
├── features/               # Feature modules (business logic lives here)
│   ├── analytics/
│   │   ├── components/     # KpiGrid
│   │   └── server/         # getAnalytics()
│   ├── campaigns/
│   │   ├── components/     # CampaignCard
│   │   └── server/         # getCampaigns(), getCampaignDetail()
│   ├── drafts/
│   │   ├── components/     # DraftsTable, DraftReviewDrawer
│   │   └── server/         # getDrafts(), generateDraft(), reviewDraft()
│   ├── replies/
│   │   ├── components/     # RepliesTable
│   │   └── server/         # ingestReply(), getReplies()
│   ├── messages/
│   │   └── server/         # sendDraft()
│   └── leads/
│       └── server/         # getLeads(), scoreLeads(), importCsv()
├── lib/
│   ├── ai/                 # AI provider abstraction (OpenAI adapter + interface)
│   ├── db/                 # Prisma client singleton
│   └── auth/               # resolveOrganization()
└── components/             # Shared UI (Badge, Header, Sidebar, etc.)
```

**Multi-tenant model:** Every query filters by `organizationId`. The `resolveOrganization(clerkOrgId)` helper translates Clerk's external ID to the internal Prisma `Organization.id` used as FK on all tenant-scoped tables.

**AI abstraction:** `getAIProvider()` returns a provider implementing `AIProvider` interface. The OpenAI adapter is the only implementation; the interface makes it mockable and swappable without touching callsites.

**Draft pipeline:** AI generates drafts → human reviews in drawer (approve/edit/reject) → approved drafts sent via SendGrid → delivery and reply events tracked per message.

**Event pipeline:** SendGrid webhooks POST to `/api/webhooks/sendgrid`. Events are upserted by unique `sgEventId` (idempotent). Analytics queries use `groupBy(['outboundMessageId'])` to count distinct messages that received each event type — avoiding inflation from multiple opens/clicks per message.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Database | PostgreSQL + Prisma v7 (`@prisma/adapter-pg`) |
| Auth | Clerk (organizations, SSO) |
| AI | OpenAI (`gpt-4o`) via provider abstraction |
| Email | SendGrid (outbound send + inbound parse + webhooks) |
| Testing | Vitest + React Testing Library |
| Deployment | Vercel |

---

## Analytics Dashboard

The analytics page aggregates 8 org-scoped metrics in a single `Promise.all` call:

| Metric | Source | Notes |
|---|---|---|
| Sent | `outboundMessage.count` | All outbound messages for org |
| Delivered | `messageEvent.groupBy(outboundMessageId)` where `DELIVERED` | Distinct messages, not event rows |
| Opened | `messageEvent.groupBy(outboundMessageId)` where `OPENED` | Distinct messages |
| Clicked | `messageEvent.groupBy(outboundMessageId)` where `CLICKED` | Distinct messages |
| Replies | `inboundReply.count` | All inbound replies |
| Positive Replies | `inboundReply.count` where `POSITIVE` | Classification filter |
| Bounced | `messageEvent.groupBy(outboundMessageId)` where `BOUNCED` | Distinct messages |
| Unsubscribes | `messageEvent.groupBy(outboundMessageId)` where `UNSUBSCRIBED` | Distinct messages |

Rates are computed in the `KpiGrid` component: delivery rate = delivered/sent, open rate = opened/delivered, etc.

---

## Testing

```
148 tests across 22 test files — all passing
```

**Patterns used:**

- **TDD throughout** — tests written before implementation for all server functions
- **No database in unit tests** — Prisma client fully mocked with `vi.mock('@/lib/db/prisma', ...)`
- **AI provider mocked** — `vi.mock('@/lib/ai', ...)` for all reply classification tests
- **Vitest hoisting** — all `vi.mock(...)` calls appear before imports (required for module hoisting)
- **jsdom via `environmentMatchGlobs`** — `.test.tsx` files automatically run in jsdom; node is the global default; `pool: 'threads'` required for React 19 + Node 25 compatibility
- **Component tests** — `DraftsTable`, `DraftReviewDrawer`, `CampaignCard`, `KpiGrid` all have isolated rendering tests with jsdom
- **groupBy semantics verified** — analytics tests assert call count and event type order through `Promise.all`

Run the full suite:

```bash
npx vitest run
```

---

## Local Setup

**Prerequisites:** Node.js 20+, Docker Desktop

```bash
git clone https://github.com/justintud23/outboundos-site
cd outboundos-site
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

```env
# Database — matches the Docker Compose config below
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/outboundos"

# Clerk — create a project at clerk.com, enable Organizations
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# SendGrid — optional for local dev (reply ingestion and webhooks)
SENDGRID_API_KEY=SG...
SENDGRID_FROM_EMAIL=outreach@yourdomain.com
SENDGRID_WEBHOOK_SECRET=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Database (Docker)

PostgreSQL runs locally via Docker. A `docker-compose.yml` is included.

```bash
# Start the database
docker compose up -d

# Apply migrations and seed demo data
npx prisma migrate deploy
npx prisma db seed

# Start the app
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, create an organization, and you're in.

### Database management

```bash
# Stop the database (data is preserved)
docker compose down

# Wipe all data and start fresh
docker compose down -v
docker compose up -d
npx prisma migrate deploy
npx prisma db seed
```

---

## Demo Walkthrough

1. **Sign up** — create an account and organization via Clerk
2. **Seed demo data** — `npx prisma db seed` populates leads, a campaign, drafts, sent messages, events, and AI-classified replies
3. **Campaigns** — visit `/campaigns`; see the campaign card with messages sent, pending drafts, and reply count; click a campaign name to drill into the detail page
4. **Campaign Detail** — visit `/campaigns/[id]`; see 5 stat cards, a drafts table with status badges, and a replies table with AI classifications; amber banner CTAs when drafts are pending
5. **Draft Review** — visit `/drafts` (or follow the "Review now" CTA); amber banner shows pending count; open a draft to see the lead's name/company, the AI-generated email, and approve or edit before approving
6. **Send** — approved drafts get a Send button; one click dispatches via SendGrid and removes the draft from the queue
7. **Receive events** — delivery, open, click, bounce events arrive via SendGrid webhook; idempotent upsert by `sgEventId`
8. **Inbound reply** — a lead replies; SendGrid Inbound Parse POSTs to `/api/replies`; the reply is AI-classified and stored
9. **Analytics** — visit `/analytics` for 8 live KPI cards with computed rates
10. **Replies** — visit `/replies` for the full reply history with classification filter and POSITIVE row highlighting

---

## Screenshots

![Dashboard](public/screenshots/dashboard.png)
![Analytics](public/screenshots/analytics.png)
![Leads](public/screenshots/leads.png)
![Replies](public/screenshots/replies.png)

| File | Description |
|---|---|
| `public/screenshots/dashboard.png` | Dashboard — lead/campaign/reply counts, recent replies |
| `public/screenshots/analytics.png` | Analytics — 8 KPI cards with computed rates |
| `public/screenshots/leads.png` | Leads table — status badges and AI scores |
| `public/screenshots/replies.png` | Replies — classification filter and POSITIVE row highlighting |

---

## Roadmap

**Draft Flow**
- [x] AI draft generation
- [x] Human review drawer (approve / edit / reject)
- [x] Pending review CTA banner
- [x] Filter tabs (All / Pending / Approved)
- [x] One-click send from approved queue

**Campaigns**
- [x] Campaign cards with message + draft + reply counts
- [x] Summary cards (Campaigns / Sent / Pending / Replies)
- [x] Campaign Detail page (`/campaigns/[id]`) — drafts + replies + stats
- [ ] Per-campaign time-series analytics
- [ ] Campaign builder UI

**Analytics v2**
- [ ] Time-series charts (sent/opened/replied per day)
- [ ] Per-campaign breakdown
- [ ] Export to CSV

**Platform**
- [ ] Lead import (CSV upload UI)
- [ ] Campaign scheduling
- [ ] Unsubscribe link auto-injection
- [ ] Webhook retry queue

---

## Resume Bullets

- **Built a multi-tenant SaaS** with Clerk Organizations + Prisma, where every query is org-scoped through a single `resolveOrganization()` translation layer — Clerk's external ID never appears as a database FK
- **Designed a deduplication-aware analytics pipeline** using `prisma.messageEvent.groupBy` to count distinct messages with each event type, preventing inflation from multiple opens/clicks per message across 8 parallel queries
- **Implemented AI reply classification** with a provider abstraction (`AIProvider` interface + OpenAI adapter) that supports custom per-org prompt templates with fallback defaults, fully tested via Vitest mocks without hitting the OpenAI API
- **Built a human-in-the-loop draft review flow** — AI generates email drafts, humans approve or edit in a live drawer UI, approved drafts dispatch via SendGrid with full delivery tracking; state updates reflect immediately without page reloads
- **Shipped a campaigns dashboard** with per-campaign reply counts derived via cross-table relation filters (`inboundReply` → `outboundMessage.campaignId`), all computed in a single `Promise.all` with no N+1 queries

---

## Why This Project Stands Out

Most portfolio projects are CRUD apps with no real architecture decisions. OutboundOS tackles problems that come up in production SaaS:

- **Multi-tenancy done right** — not just a `userId` filter, but a proper org resolution layer separating auth provider IDs from database FKs
- **Event deduplication** — analytics that don't lie when SendGrid delivers multiple OPENED events per message
- **AI without coupling** — a provider abstraction that lets you swap models or mock in tests without touching business logic
- **Human-in-the-loop AI** — draft generation is only half the story; the review flow (filter tabs, lead context, edit-before-approve) makes the AI output visible and correctable, which is how real AI-assisted tools work
- **Test discipline** — TDD throughout, Prisma fully mocked, component tests isolated with jsdom, 148 tests passing across server functions and React components
