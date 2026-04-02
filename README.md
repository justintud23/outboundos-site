# OutboundOS

**AI-powered outbound sales automation — multi-tenant SaaS with reply intelligence, analytics, and email orchestration.**

---

## Overview

OutboundOS is a full-stack SaaS platform for managing outbound email campaigns. Each organization gets isolated campaign management, AI-classified inbound replies, real-time delivery analytics, and a customizable prompt template system — all scoped to their tenant by Clerk organization membership.

Built as a portfolio project demonstrating production-grade architecture patterns: feature-oriented modules, multi-tenant data isolation, AI abstraction layers, and event-driven analytics.

---

## Features

### Campaign Management
- Create and send email campaigns to lead lists via SendGrid
- Track per-message delivery, open, click, bounce, and unsubscribe events
- Webhook ingestion with HMAC signature verification

### Reply Intelligence
- Ingest inbound replies via SendGrid Inbound Parse
- AI-classify replies into: `POSITIVE`, `NEUTRAL`, `NEGATIVE`, `OUT_OF_OFFICE`, `UNSUBSCRIBE_REQUEST`, `REFERRAL`, `UNKNOWN`
- Link replies to originating outbound message via `sgMessageId` correlation
- Custom prompt templates per organization (with fallback defaults)

### Analytics Dashboard
- 8 KPI cards: Sent, Delivered, Opened, Clicked, Replies, Positive Replies, Bounced, Unsubscribes
- Deduplication-aware event counting (one message = one delivered/opened/clicked, not one per event row)
- Computed delivery, open, click, bounce, and positive reply rates
- Recent replies preview

### Replies Table
- Full reply history with sender, classification badge, and timestamp
- Client-side classification filter (All / per-class)
- Visual highlighting for `POSITIVE` rows
- Distinct badge styles for `UNSUBSCRIBE_REQUEST` and `OUT_OF_OFFICE`

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
│   └── api/                # Thin route handlers (no business logic)
├── features/               # Feature modules (business logic lives here)
│   ├── analytics/
│   │   ├── components/     # KpiGrid, etc.
│   │   └── server/         # getAnalytics()
│   ├── replies/
│   │   ├── components/     # RepliesTable
│   │   └── server/         # ingestReply(), getReplies()
│   └── campaigns/
├── lib/
│   ├── ai/                 # AI provider abstraction (OpenAI adapter + interface)
│   ├── db/                 # Prisma client singleton
│   └── auth/               # resolveOrganization()
└── components/             # Shared UI (Badge, Header, Sidebar, etc.)
```

**Multi-tenant model:** Every query filters by `organizationId`. The `resolveOrganization(clerkOrgId)` helper translates Clerk's external ID to the internal Prisma `Organization.id` used as FK on all tenant-scoped tables.

**AI abstraction:** `getAIProvider()` returns a provider implementing `AIProvider` interface. The OpenAI adapter is the only implementation; the interface makes it mockable and swappable without touching callsites.

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
96 tests across 16 test files — all passing
```

**Patterns used:**

- **TDD throughout** — tests written before implementation for all server functions
- **No database in unit tests** — Prisma client fully mocked with `vi.mock('@/lib/db/prisma', ...)`
- **AI provider mocked** — `vi.mock('@/lib/ai', ...)` for all reply classification tests
- **Vitest hoisting** — all `vi.mock(...)` calls appear before imports (required for module hoisting)
- **jsdom per-file** — `// @vitest-environment jsdom` pragma on component tests; global env stays `node`
- **groupBy semantics verified** — analytics tests assert call count and event type order through `Promise.all`

Run the full suite:

```bash
npx vitest run
```

---

## Local Setup

**Prerequisites:** Node.js 20+, PostgreSQL running locally

```bash
git clone https://github.com/justintud23/outboundos-site
cd outboundos-site
npm install
cp .env.example .env
```

Fill in `.env`:

```env
# Database
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

```bash
npx prisma migrate dev
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign up, create an organization, and you're in.

---

## Demo Walkthrough

1. **Sign up** — create an account and organization via Clerk
2. **Add leads** — import or create leads associated with your org
3. **Create a campaign** — compose an outreach email with a custom subject and body
4. **Send** — campaign dispatches via SendGrid; outbound messages are tracked per lead
5. **Receive events** — delivery, open, click, bounce events arrive via SendGrid webhook
6. **Inbound reply** — a lead replies; SendGrid Inbound Parse POSTs to `/api/replies`; the reply is AI-classified and stored
7. **Analytics** — visit the Analytics page for live KPIs; visit Replies for the full reply history with classification filter

---

## Screenshots

> _Screenshots coming soon — run locally to see the dashboard_

| Screen | Description |
|---|---|
| `screenshots/dashboard.png` | Main dashboard with campaign list |
| `screenshots/analytics.png` | Analytics dashboard — 8 KPI cards |
| `screenshots/replies.png` | Replies table with classification filter |
| `screenshots/reply-positive.png` | POSITIVE reply row highlighting |
| `screenshots/analytics-rates.png` | Delivery and open rate cards |

---

## Roadmap

**Analytics v2**
- [ ] Time-series charts (sent/opened/replied per day)
- [ ] Per-campaign breakdown
- [ ] Export to CSV

**Platform**
- [ ] Lead import (CSV upload)
- [ ] Campaign scheduling
- [ ] Unsubscribe link auto-injection
- [ ] Webhook retry queue

---

## Resume Bullets

- **Built a multi-tenant SaaS** with Clerk Organizations + Prisma, where every query is org-scoped through a single `resolveOrganization()` translation layer — Clerk's external ID never appears as a database FK
- **Designed a deduplication-aware analytics pipeline** using `prisma.messageEvent.groupBy` to count distinct messages with each event type, preventing inflation from multiple opens/clicks per message across 8 parallel queries
- **Implemented AI reply classification** with a provider abstraction (`AIProvider` interface + OpenAI adapter) that supports custom per-org prompt templates with fallback defaults, fully tested via Vitest mocks without hitting the OpenAI API

---

## Why This Project Stands Out

Most portfolio projects are CRUD apps with no real architecture decisions. OutboundOS tackles problems that come up in production SaaS:

- **Multi-tenancy done right** — not just a `userId` filter, but a proper org resolution layer separating auth provider IDs from database FKs
- **Event deduplication** — analytics that don't lie when SendGrid delivers multiple OPENED events per message
- **AI without coupling** — a provider abstraction that lets you swap models or mock in tests without touching business logic
- **Test discipline** — TDD throughout, Prisma fully mocked, component tests isolated with jsdom, 96 tests passing
