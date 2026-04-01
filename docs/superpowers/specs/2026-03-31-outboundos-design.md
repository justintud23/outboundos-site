# OutboundOS — Foundation Design Spec

**Date:** 2026-03-31
**Status:** Approved

---

## What We Are Building

OutboundOS is a multi-tenant SaaS platform for AI-assisted sales outreach. Companies sign up, import leads, let AI score and draft personalized emails, approve those drafts, and send them via SendGrid. Engagement (opens, clicks, replies) is tracked and fed back into the pipeline.

This spec covers the **v1 foundation**: project scaffolding, auth, schema, layout, and one working end-to-end slice (CSV import → AI scoring).

---

## Key Decisions

### Multi-tenancy
Every tenant-owned table carries `organizationId`. No query runs without it. Clerk `Organizations` is the source of truth for org identity — `Organization.clerkId` is the link. An `OrgMember` table stores `clerkUserId + organizationId + role` for auditability and ownership queries without duplicating Clerk's user store.

### Auth — Clerk (not NextAuth)
Clerk ships multi-tenant `Organizations` as a first-class primitive. With NextAuth you'd build org membership, invitation flows, and role management from scratch. Clerk's free tier covers 10,000 MAUs. `middleware.ts` gates all `(dashboard)` routes. `organizationId` is pulled from the Clerk session on every server call.

### Architecture — Feature-oriented monolith
Single Next.js App Router application. Features live under `src/features/<name>/`. Shared infrastructure under `src/lib/`. No monorepo, no separate API server. Feature folders provide clean boundaries without ceremony.

### AI — Provider abstraction
All AI calls go through `src/lib/ai/index.ts`. Feature code never imports a provider directly. v1 ships with an OpenAI adapter. Swapping providers or routing by prompt type requires only changes inside `src/lib/ai/`.

### Approval before send
A `Draft` record is the gate between AI generation and `OutboundMessage`. No lead is emailed without a Draft reaching `DraftStatus.APPROVED`. The Draft links to the exact `PromptTemplate` version that generated it.

---

## Folder Structure

```
src/
├── app/
│   ├── (auth)/                   # Clerk sign-in / sign-up pages
│   ├── (dashboard)/              # Protected route group
│   │   ├── layout.tsx            # Sidebar + header shell
│   │   ├── dashboard/page.tsx
│   │   ├── leads/page.tsx
│   │   ├── campaigns/page.tsx
│   │   ├── sequences/page.tsx
│   │   ├── inbox/page.tsx
│   │   ├── analytics/page.tsx
│   │   ├── templates/page.tsx
│   │   └── settings/page.tsx
│   └── api/
│       ├── leads/route.ts        # HTTP only — delegates to features/leads
│       └── webhooks/
│           └── sendgrid/route.ts
├── features/
│   ├── leads/
│   │   ├── components/
│   │   ├── server/
│   │   │   ├── import-csv.ts
│   │   │   ├── score-leads.ts
│   │   │   └── create-lead.ts
│   │   ├── hooks/
│   │   ├── schemas.ts
│   │   └── types.ts
│   ├── campaigns/
│   │   ├── components/
│   │   ├── server/
│   │   ├── hooks/
│   │   ├── schemas.ts
│   │   └── types.ts
│   ├── sequences/
│   ├── inbox/
│   └── analytics/
├── lib/
│   ├── db/
│   │   └── prisma.ts             # Prisma singleton
│   ├── ai/
│   │   ├── index.ts              # Public interface
│   │   ├── provider.ts           # AIProvider interface
│   │   ├── openai.ts             # OpenAI adapter
│   │   └── router.ts             # Maps prompt type → provider
│   ├── email/
│   │   └── sendgrid.ts           # SendGrid wrapper
│   └── integrations/
│       └── webhooks/
├── components/
│   ├── ui/                       # Reusable primitives (Button, Input, Badge, etc.)
│   └── layout/
│       ├── sidebar.tsx
│       ├── header.tsx
│       └── nav-item.tsx
└── middleware.ts                 # Clerk auth gate
```

---

## Prisma Schema

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── ENUMS ────────────────────────────────────────────────────

enum LeadSource {
  CSV
  MANUAL
  HUBSPOT
  SALESFORCE
  API
}

enum LeadStatus {
  NEW
  CONTACTED
  REPLIED
  BOUNCED
  UNSUBSCRIBED
  CONVERTED
}

enum ImportStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

enum CampaignStatus {
  DRAFT
  ACTIVE
  PAUSED
  COMPLETED
  ARCHIVED
}

enum DraftStatus {
  PENDING_REVIEW
  APPROVED
  REJECTED
  // SENT intentionally omitted — send state lives on OutboundMessage, not Draft
}

enum MessageStatus {
  QUEUED
  SENT
  DELIVERED
  OPENED
  CLICKED
  REPLIED
  BOUNCED
  FAILED
}

enum MessageEventType {
  DELIVERED
  OPENED
  CLICKED
  BOUNCED
  SPAM_REPORT
  UNSUBSCRIBED
  DEFERRED
  DROPPED
}

enum ReplyClassification {
  POSITIVE
  NEUTRAL
  NEGATIVE
  OUT_OF_OFFICE
  UNSUBSCRIBE_REQUEST
  REFERRAL
  UNKNOWN
}

enum PromptType {
  LEAD_SCORING
  EMAIL_DRAFT
  REPLY_CLASSIFICATION
  SUBJECT_LINE
}

// ─── ORGANIZATION ──────────────────────────────────────────────

model Organization {
  id        String   @id @default(cuid())
  clerkId   String   @unique
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  members          OrgMember[]
  leads            Lead[]
  importBatches    ImportBatch[]
  campaigns        Campaign[]
  sequences        Sequence[]
  mailboxes        Mailbox[]
  drafts           Draft[]
  outboundMessages OutboundMessage[]
  inboundReplies   InboundReply[]
  auditLogs        AuditLog[]
  promptTemplates  PromptTemplate[]

  @@map("organizations")
}

// ─── MEMBERS ───────────────────────────────────────────────────

model OrgMember {
  id             String       @id @default(cuid())
  clerkUserId    String
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  role           String       @default("member")
  createdAt      DateTime     @default(now())

  @@unique([clerkUserId, organizationId])
  @@index([organizationId])
  @@map("org_members")
}

// ─── LEADS ─────────────────────────────────────────────────────

model Lead {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  importBatchId  String?
  importBatch    ImportBatch? @relation(fields: [importBatchId], references: [id])

  email       String
  firstName   String?
  lastName    String?
  company     String?
  title       String?
  linkedinUrl String?
  phone       String?

  source   LeadSource @default(CSV)
  status   LeadStatus @default(NEW)

  score       Int?
  scoreReason String?
  scoredAt    DateTime?

  customFields Json?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  drafts           Draft[]
  outboundMessages OutboundMessage[]
  inboundReplies   InboundReply[]

  @@unique([organizationId, email])
  @@index([organizationId])
  @@index([organizationId, status])
  @@index([organizationId, score])
  @@index([organizationId, scoredAt]) // "recently scored" queries + analytics
  @@index([importBatchId])
  @@map("leads")
}

// ─── IMPORT BATCHES ────────────────────────────────────────────

model ImportBatch {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  fileName     String
  rowCount     Int          @default(0)
  successCount Int          @default(0)
  errorCount   Int          @default(0)
  status       ImportStatus @default(PENDING)
  errorLog     Json?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  leads Lead[]

  @@index([organizationId])
  @@index([organizationId, status])
  @@map("import_batches")
}

// ─── CAMPAIGNS ─────────────────────────────────────────────────

model Campaign {
  id             String         @id @default(cuid())
  organizationId String
  organization   Organization   @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  mailboxId      String?
  mailbox        Mailbox?       @relation(fields: [mailboxId], references: [id])

  name        String
  description String?
  status      CampaignStatus @default(DRAFT)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  sequences        Sequence[]
  outboundMessages OutboundMessage[]

  @@index([organizationId])
  @@index([organizationId, status])
  @@map("campaigns")
}

// ─── SEQUENCES ─────────────────────────────────────────────────

model Sequence {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  campaignId     String
  campaign       Campaign     @relation(fields: [campaignId], references: [id], onDelete: Cascade)

  name String

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  steps  SequenceStep[]
  drafts Draft[]

  @@index([organizationId])
  @@index([campaignId])
  @@map("sequences")
}

model SequenceStep {
  id         String   @id @default(cuid())
  sequenceId String
  sequence   Sequence @relation(fields: [sequenceId], references: [id], onDelete: Cascade)

  stepNumber Int
  subject    String
  body       String
  delayDays  Int @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  drafts Draft[]

  @@unique([sequenceId, stepNumber])
  @@index([sequenceId])
  @@map("sequence_steps")
}

// ─── MAILBOXES ─────────────────────────────────────────────────

model Mailbox {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  email       String
  displayName String
  isActive    Boolean  @default(true)
  dailyLimit  Int      @default(50)
  sentToday   Int      @default(0)    // reset to 0 by daily scheduled job
  lastResetAt DateTime @default(now()) // timestamp of last reset — no per-send recalculation

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  campaigns        Campaign[]
  outboundMessages OutboundMessage[]

  @@unique([organizationId, email])
  @@index([organizationId])
  @@map("mailboxes")
}

// ─── DRAFTS ────────────────────────────────────────────────────

model Draft {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  leadId         String
  lead           Lead         @relation(fields: [leadId], references: [id], onDelete: Cascade)

  campaignId     String?
  campaign       Campaign?     @relation(fields: [campaignId], references: [id])
  sequenceId     String?
  sequence       Sequence?     @relation(fields: [sequenceId], references: [id])
  sequenceStepId String?
  sequenceStep   SequenceStep? @relation(fields: [sequenceStepId], references: [id])

  promptTemplateId String?
  promptTemplate   PromptTemplate? @relation(fields: [promptTemplateId], references: [id])

  subject String
  body    String
  status  DraftStatus @default(PENDING_REVIEW)

  createdByClerkId  String?
  approvedByClerkId String?
  approvedAt        DateTime?
  rejectedAt        DateTime?
  rejectionReason   String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  outboundMessages OutboundMessage[]

  @@index([organizationId])
  @@index([organizationId, status])
  @@index([leadId])
  @@map("drafts")
}

// ─── OUTBOUND MESSAGES ─────────────────────────────────────────

model OutboundMessage {
  id             String        @id @default(cuid())
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  leadId         String
  lead           Lead          @relation(fields: [leadId], references: [id])
  mailboxId      String
  mailbox        Mailbox       @relation(fields: [mailboxId], references: [id])
  campaignId     String?
  campaign       Campaign?     @relation(fields: [campaignId], references: [id])
  draftId        String?
  draft          Draft?        @relation(fields: [draftId], references: [id])

  sgMessageId String?       @unique
  subject     String
  body        String
  status      MessageStatus @default(QUEUED)
  sentAt      DateTime?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  events         MessageEvent[]
  inboundReplies InboundReply[]

  @@index([organizationId])
  @@index([organizationId, status])
  @@index([leadId])
  @@index([mailboxId])
  @@map("outbound_messages")
}

// ─── MESSAGE EVENTS ────────────────────────────────────────────
// organizationId is denormalized (no FK) intentionally:
// webhook ingestion must succeed even under partial failure.
// Integrity is guaranteed via outboundMessage → organization chain.

model MessageEvent {
  id                String          @id @default(cuid())
  organizationId    String          // denormalized for query perf — no FK by design
  outboundMessageId String
  outboundMessage   OutboundMessage @relation(fields: [outboundMessageId], references: [id], onDelete: Cascade)

  eventType          MessageEventType
  providerEventType  String?           // raw provider string — handles new/unknown event types without enum failures
  providerTimestamp  DateTime?
  rawPayload         Json

  createdAt DateTime @default(now())

  @@index([outboundMessageId])
  @@index([organizationId])
  @@index([organizationId, eventType])
  @@map("message_events")
}

// ─── INBOUND REPLIES ───────────────────────────────────────────

model InboundReply {
  id                String           @id @default(cuid())
  organizationId    String
  organization      Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  leadId            String
  lead              Lead             @relation(fields: [leadId], references: [id])
  outboundMessageId String?
  outboundMessage   OutboundMessage? @relation(fields: [outboundMessageId], references: [id])

  rawBody                  String
  classification           ReplyClassification @default(UNKNOWN)
  classificationConfidence Float?

  receivedAt DateTime @default(now())
  createdAt  DateTime @default(now())

  @@index([organizationId])
  @@index([leadId])
  @@index([outboundMessageId])
  @@map("inbound_replies")
}

// ─── AUDIT LOGS ────────────────────────────────────────────────

model AuditLog {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  actorClerkId String?
  action       String
  entityType   String
  entityId     String
  metadata     Json?

  createdAt DateTime @default(now())

  @@index([organizationId])
  @@index([organizationId, entityType, entityId])
  @@index([actorClerkId])
  @@map("audit_logs")
}

// ─── PROMPT TEMPLATES ──────────────────────────────────────────

model PromptTemplate {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  name       String
  promptType PromptType
  version    Int        @default(1)
  body       String
  isActive   Boolean    @default(true)
  notes      String?

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  drafts Draft[]

  @@unique([organizationId, promptType, version])
  @@index([organizationId])
  @@index([organizationId, promptType, isActive])
  @@map("prompt_templates")
}

// Invariant: only one PromptTemplate per (organizationId, promptType) may have
// isActive = true at a time. Enforced at app layer — when activating a new
// version, the previous active record must be deactivated in the same transaction.
```

---

## Working Slice: CSV Import → AI Scoring

```
POST /api/leads/import
  └── parse multipart/form-data
  └── call importCsv({ organizationId, file })
        ├── create ImportBatch { status: PROCESSING }
        ├── parse rows → validate with CsvRowSchema (Zod)
        ├── upsert Lead[] scoped to organizationId
        │     @@unique([organizationId, email]) prevents duplicates
        └── update ImportBatch { successCount, errorCount, status }

  └── call scoreLeads({ organizationId, leadIds })
        ├── fetch active PromptTemplate { promptType: LEAD_SCORING, isActive: true }
        ├── for each lead: lib/ai → provider.score(lead, prompt)
        │     returns { score: 0–100, reason: string }
        └── update Lead { score, scoreReason, scoredAt }
```

**Invariants:**
- Every DB write passes `organizationId` explicitly
- Route handlers: parse → call → respond only
- Feature server files: pure logic, typed inputs/outputs, no HTTP
- AI calls: always through `lib/ai/index.ts`, never direct provider imports

---

## Visual Direction

Dark theme. Icon-only sidebar (52px). Indigo/violet accent (`#6366f1`). Dense data layout. Reference: Apollo, Clay.

---

## Tech Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 15, App Router |
| Language | TypeScript strict |
| Styling | Tailwind CSS v4 |
| ORM | Prisma |
| Database | PostgreSQL |
| Auth | Clerk (Organizations) |
| AI | OpenAI adapter behind `lib/ai` interface |
| Email | SendGrid |
| Validation | Zod |

---

## Environment Variables

```bash
# Database
DATABASE_URL=

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# OpenAI
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o

# SendGrid
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
SENDGRID_WEBHOOK_SECRET=

# App
NEXT_PUBLIC_APP_URL=
```

---

## Out of Scope for v1

- Email scheduling / background job queue (Inngest, BullMQ)
- HubSpot / Salesforce sync
- Billing (Stripe)
- Team invitation flows beyond Clerk's built-in UI
- Analytics charts (placeholder page only)
