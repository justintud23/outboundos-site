# OutboundOS Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the OutboundOS project foundation — scaffolding, auth, schema, dashboard shell, and one working end-to-end slice: CSV upload → ImportBatch → Lead creation → AI scoring → leads UI.

**Architecture:** Feature-oriented Next.js 15 monolith. All business logic lives in `src/features/<name>/server/`. Route handlers are thin (parse → call → respond). Every DB query is org-scoped via Clerk's `organizationId`. AI calls route through a provider abstraction in `src/lib/ai/`.

**Tech Stack:** Next.js 15 (App Router), TypeScript strict, Tailwind CSS v4, Prisma 5, PostgreSQL, Clerk (Organizations), OpenAI via provider abstraction, Zod, PapaParse, Vitest

---

## File Map

```
/
├── prisma/
│   └── schema.prisma                          CREATE — full production schema
├── .env.example                               CREATE — all required keys
├── vitest.config.ts                           CREATE — test runner config
├── src/
│   ├── middleware.ts                          CREATE — Clerk auth gate
│   ├── app/
│   │   ├── layout.tsx                         MODIFY — add ClerkProvider
│   │   ├── globals.css                        MODIFY — Tailwind v4 import
│   │   ├── (auth)/
│   │   │   ├── sign-in/[[...sign-in]]/page.tsx  CREATE
│   │   │   └── sign-up/[[...sign-up]]/page.tsx  CREATE
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx                     CREATE — sidebar + header shell
│   │   │   ├── dashboard/page.tsx             CREATE — placeholder
│   │   │   ├── leads/page.tsx                 CREATE — real: table + upload
│   │   │   ├── campaigns/page.tsx             CREATE — placeholder
│   │   │   ├── sequences/page.tsx             CREATE — placeholder
│   │   │   ├── inbox/page.tsx                 CREATE — placeholder
│   │   │   ├── analytics/page.tsx             CREATE — placeholder
│   │   │   ├── templates/page.tsx             CREATE — placeholder
│   │   │   └── settings/page.tsx              CREATE — placeholder
│   │   └── api/
│   │       └── leads/
│   │           └── import/route.ts            CREATE — thin route handler
│   ├── lib/
│   │   ├── db/
│   │   │   └── prisma.ts                      CREATE — Prisma singleton
│   │   └── ai/
│   │       ├── provider.ts                    CREATE — AIProvider interface
│   │       ├── openai.ts                      CREATE — OpenAI adapter
│   │       ├── router.ts                      CREATE — prompt type → provider
│   │       └── index.ts                       CREATE — public API
│   ├── components/
│   │   ├── ui/
│   │   │   ├── button.tsx                     CREATE
│   │   │   ├── badge.tsx                      CREATE
│   │   │   └── input.tsx                      CREATE
│   │   └── layout/
│   │       ├── sidebar.tsx                    CREATE
│   │       ├── header.tsx                     CREATE
│   │       └── nav-item.tsx                   CREATE
│   └── features/
│       └── leads/
│           ├── types.ts                       CREATE — LeadDTO, ImportBatchResult, LeadScoreResult
│           ├── schemas.ts                     CREATE — CsvRowSchema, CreateLeadSchema
│           ├── server/
│           │   ├── import-csv.ts              CREATE — parse + upsert leads
│           │   ├── score-leads.ts             CREATE — AI scoring
│           │   └── get-leads.ts               CREATE — org-scoped list
│           └── components/
│               ├── csv-upload-form.tsx        CREATE — file picker + POST
│               └── leads-table.tsx            CREATE — data table
```

---

## Phase 1: Project Bootstrap

**Goal:** Scaffold a working Next.js 15 app with all dependencies installed, Tailwind v4 configured, TypeScript strict, and Vitest ready.

**Files:** `package.json`, `tsconfig.json`, `postcss.config.mjs`, `src/app/globals.css`, `vitest.config.ts`

---

- [ ] **1.1 — Scaffold the app**

Run from inside `/Users/justintud/Desktop/Coding Projects/outboundos-site`:

```bash
npx create-next-app@latest . \
  --typescript \
  --eslint \
  --app \
  --src-dir \
  --no-import-alias \
  --tailwind \
  --yes
```

Expected output: `Success! Created outboundos-site`

- [ ] **1.2 — Install all project dependencies**

```bash
npm install \
  @clerk/nextjs \
  @prisma/client \
  zod \
  openai \
  papaparse \
  lucide-react \
  clsx \
  @sendgrid/mail

npm install -D \
  prisma \
  @types/papaparse \
  vitest \
  @vitejs/plugin-react \
  @testing-library/react \
  @testing-library/jest-dom \
  jsdom \
  @types/node
```

- [ ] **1.3 — Upgrade to Tailwind v4**

```bash
npm uninstall tailwindcss @tailwindcss/postcss autoprefixer
npm install tailwindcss@^4 @tailwindcss/postcss
```

Delete `tailwind.config.ts` if it was generated:

```bash
rm -f tailwind.config.ts
```

- [ ] **1.4 — Update postcss config**

Replace the contents of `postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

- [ ] **1.5 — Update globals.css for Tailwind v4**

Replace `src/app/globals.css` entirely:

```css
@import "tailwindcss";

:root {
  --background: #0f1117;
  --foreground: #e2e8f0;
  --sidebar-bg: #13151c;
  --sidebar-border: #1e2130;
  --card-bg: #1a1d2e;
  --accent: #6366f1;
  --accent-hover: #4f46e5;
  --muted: #94a3b8;
  --border: #2a2d3e;
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: var(--font-geist-sans, system-ui, sans-serif);
}
```

- [ ] **1.6 — Enable TypeScript strict mode**

Verify `tsconfig.json` has `"strict": true`. If not, add it under `compilerOptions`:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true
  }
}
```

- [ ] **1.7 — Create Vitest config**

Create `vitest.config.ts` at the project root:

```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

- [ ] **1.8 — Add test script to package.json**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **1.9 — Verify bootstrap**

```bash
npm run dev
```

Expected: Next.js dev server starts on http://localhost:3000 with no errors.

```bash
npm run build
```

Expected: Build succeeds (ignore "no tests" warning).

- [ ] **1.10 — Commit**

```bash
git init
git add .
git commit -m "feat: scaffold Next.js 15 app with Tailwind v4, Vitest, all deps"
```

**Acceptance criteria:** `npm run dev` starts cleanly. `npm run build` passes. No TypeScript errors.

**Common failure points:**
- `create-next-app` may install Tailwind v3 — the explicit uninstall/reinstall in 1.3 handles this.
- `noUncheckedIndexedAccess` may surface errors in generated Next.js files — disable it if it causes cascading issues in generated code.

---

## Phase 2: Environment & Prisma Schema

**Goal:** `.env.example` documents every key. `prisma/schema.prisma` contains the full v1 schema. First migration runs cleanly.

**Files:** `.env.example`, `.env.local`, `prisma/schema.prisma`

**Prerequisites:** A running PostgreSQL instance. Locally, use Docker: `docker run --name outboundos-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=outboundos -p 5432:5432 -d postgres:16`

---

- [ ] **2.1 — Create .env.example**

Create `.env.example` at the project root:

```bash
# ── Database ──────────────────────────────────────────────────
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/outboundos"

# ── Clerk ─────────────────────────────────────────────────────
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/dashboard

# ── OpenAI ────────────────────────────────────────────────────
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o

# ── SendGrid ──────────────────────────────────────────────────
SENDGRID_API_KEY=SG...
SENDGRID_FROM_EMAIL=outreach@yourdomain.com
SENDGRID_WEBHOOK_SECRET=

# ── App ───────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **2.2 — Create .env.local**

```bash
cp .env.example .env.local
```

Fill in real values for `DATABASE_URL`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, and `OPENAI_API_KEY`. Leave SendGrid keys blank for now.

- [ ] **2.3 — Add .env.local to .gitignore**

Verify `.gitignore` contains `.env.local` and `.env`. Add if missing:

```
.env.local
.env
.superpowers/
```

- [ ] **2.4 — Initialize Prisma**

```bash
npx prisma init --datasource-provider postgresql
```

Expected: `prisma/schema.prisma` and `prisma/` directory created.

- [ ] **2.5 — Write the full schema**

Replace `prisma/schema.prisma` entirely:

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
  @@index([organizationId, scoredAt])
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
  sentToday   Int      @default(0)   // reset to 0 by daily scheduled job
  lastResetAt DateTime @default(now()) // timestamp of last reset

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

model MessageEvent {
  id                String          @id @default(cuid())
  organizationId    String          // denormalized — no FK by design
  outboundMessageId String
  outboundMessage   OutboundMessage @relation(fields: [outboundMessageId], references: [id], onDelete: Cascade)

  eventType         MessageEventType
  providerEventType String?          // raw provider string — handles unknown event types
  providerTimestamp DateTime?
  rawPayload        Json

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
// Invariant: only one PromptTemplate per (organizationId, promptType) may have
// isActive = true. Enforced at app layer — deactivate previous in same transaction.

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
```

- [ ] **2.6 — Run initial migration**

```bash
npx prisma migrate dev --name init
```

Expected output:
```
Applying migration `20260331000000_init`
Your database is now in sync with your schema.
```

- [ ] **2.7 — Generate Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client` with no errors.

- [ ] **2.8 — Verify schema in Prisma Studio**

```bash
npx prisma studio
```

Expected: Studio opens at http://localhost:5555 showing all tables.

- [ ] **2.9 — Commit**

```bash
git add prisma/ .env.example .gitignore
git commit -m "feat: add Prisma schema with full v1 model set and initial migration"
```

**Acceptance criteria:** `npx prisma migrate dev` runs without error. All 14 tables visible in Prisma Studio. `npx prisma generate` produces no TypeScript errors.

**Common failure points:**
- `DATABASE_URL` not set in `.env.local` → migration fails with connection error.
- PostgreSQL not running → `ECONNREFUSED` — start Docker container first.
- Prisma v5 requires `@prisma/client` and `prisma` as separate packages — both were installed in Phase 1.

---

## Phase 3: Lib Infrastructure

**Goal:** Prisma singleton ready. AI abstraction layer wired up with an OpenAI adapter that can score leads.

**Files:** `src/lib/db/prisma.ts`, `src/lib/ai/provider.ts`, `src/lib/ai/openai.ts`, `src/lib/ai/router.ts`, `src/lib/ai/index.ts`

---

- [ ] **3.1 — Create Prisma singleton**

Create `src/lib/db/prisma.ts`:

```typescript
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

- [ ] **3.2 — Write the AIProvider interface**

Create `src/lib/ai/provider.ts`:

```typescript
export interface LeadScoreInput {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  title?: string | null
}

export interface LeadScoreOutput {
  leadId: string
  score: number      // 0–100
  reason: string
}

export interface AIProvider {
  scoreLeads(
    leads: LeadScoreInput[],
    promptTemplate: string,
  ): Promise<LeadScoreOutput[]>
}
```

- [ ] **3.3 — Write failing test for OpenAI adapter**

Create `src/lib/ai/openai.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock openai before importing the adapter
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    })),
  }
})

import OpenAI from 'openai'
import { OpenAIProvider } from './openai'

describe('OpenAIProvider.scoreLeads', () => {
  let provider: OpenAIProvider
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    provider = new OpenAIProvider('test-key', 'gpt-4o')
    const client = (OpenAI as ReturnType<typeof vi.fn>).mock.results[0]?.value as {
      chat: { completions: { create: ReturnType<typeof vi.fn> } }
    }
    mockCreate = client.chat.completions.create
  })

  it('returns a score and reason for each lead', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify([
              { leadId: 'lead-1', score: 75, reason: 'Senior title at mid-size company' },
            ]),
          },
        },
      ],
    })

    const result = await provider.scoreLeads(
      [{ id: 'lead-1', email: 'test@acme.com', title: 'VP of Sales', company: 'Acme' }],
      'Score this lead 0-100.',
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ leadId: 'lead-1', score: 75 })
  })

  it('returns score 0 with error reason when parsing fails', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not valid json' } }],
    })

    const result = await provider.scoreLeads(
      [{ id: 'lead-1', email: 'test@acme.com' }],
      'Score this lead.',
    )

    expect(result[0]?.score).toBe(0)
    expect(result[0]?.reason).toContain('parse')
  })
})
```

- [ ] **3.4 — Run test to verify it fails**

```bash
npm test -- src/lib/ai/openai.test.ts
```

Expected: FAIL — `Cannot find module './openai'`

- [ ] **3.5 — Implement the OpenAI adapter**

Create `src/lib/ai/openai.ts`:

```typescript
import OpenAI from 'openai'
import type { AIProvider, LeadScoreInput, LeadScoreOutput } from './provider'

export class OpenAIProvider implements AIProvider {
  private client: OpenAI
  private model: string

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey })
    this.model = model
  }

  async scoreLeads(
    leads: LeadScoreInput[],
    promptTemplate: string,
  ): Promise<LeadScoreOutput[]> {
    const leadContext = leads
      .map(
        (l) =>
          `ID: ${l.id} | Email: ${l.email} | Name: ${[l.firstName, l.lastName].filter(Boolean).join(' ')} | Title: ${l.title ?? 'Unknown'} | Company: ${l.company ?? 'Unknown'}`,
      )
      .join('\n')

    const systemPrompt = `${promptTemplate}

Return a JSON array with one object per lead:
[{ "leadId": "<id>", "score": <0-100>, "reason": "<one sentence>" }]

Respond with ONLY the JSON array. No markdown, no explanation.`

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: leadContext },
        ],
        temperature: 0.2,
      })

      const content = response.choices[0]?.message.content ?? ''
      const parsed = JSON.parse(content) as LeadScoreOutput[]
      return parsed
    } catch (err) {
      // Fallback: return 0 score for all leads so import never hard-fails
      return leads.map((l) => ({
        leadId: l.id,
        score: 0,
        reason: `Failed to parse AI response: ${err instanceof Error ? err.message : 'unknown error'}`,
      }))
    }
  }
}
```

- [ ] **3.6 — Run test to verify it passes**

```bash
npm test -- src/lib/ai/openai.test.ts
```

Expected: PASS — 2 tests passing.

- [ ] **3.7 — Create the router**

Create `src/lib/ai/router.ts`:

```typescript
import { OpenAIProvider } from './openai'
import type { AIProvider } from './provider'

let _provider: AIProvider | null = null

export function getAIProvider(): AIProvider {
  if (_provider) return _provider

  const apiKey = process.env.OPENAI_API_KEY
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o'

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not set')
  }

  _provider = new OpenAIProvider(apiKey, model)
  return _provider
}
```

- [ ] **3.8 — Create the public AI index**

Create `src/lib/ai/index.ts`:

```typescript
export { getAIProvider } from './router'
export type { AIProvider, LeadScoreInput, LeadScoreOutput } from './provider'
```

- [ ] **3.9 — Commit**

```bash
git add src/lib/
git commit -m "feat: add Prisma singleton and AI provider abstraction with OpenAI adapter"
```

**Acceptance criteria:** `npm test` passes 2 tests. No TypeScript errors in `src/lib/`.

**Common failure points:**
- Vitest module mocking with `vi.mock` must be called before the import — the test structure in 3.3 handles this correctly with `vi.mock` hoisting.
- `OPENAI_API_KEY` not set at runtime → `getAIProvider()` throws immediately — this is intentional and surfaces misconfiguration early.

---

## Phase 4: Clerk Auth + Middleware

**Goal:** All `(dashboard)` routes are protected. Sign-in/sign-up pages work. `getOrganizationId()` utility pulls the active org from the session server-side.

**Files:** `src/middleware.ts`, `src/app/layout.tsx`, `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`, `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`

**Prerequisites:** Clerk app created at [clerk.com](https://clerk.com). Enable "Organizations" in Clerk dashboard → Settings → Organizations. Copy publishable key and secret key into `.env.local`.

---

- [ ] **4.1 — Create Clerk middleware**

Create `src/middleware.ts`:

```typescript
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
```

- [ ] **4.2 — Wrap root layout with ClerkProvider**

Replace `src/app/layout.tsx`:

```typescript
import type { Metadata } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export const metadata: Metadata = {
  title: 'OutboundOS',
  description: 'AI-assisted sales outreach platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
```

- [ ] **4.3 — Create sign-in page**

Create `src/app/(auth)/sign-in/[[...sign-in]]/page.tsx`:

```typescript
import { SignIn } from '@clerk/nextjs'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f1117]">
      <SignIn />
    </div>
  )
}
```

- [ ] **4.4 — Create sign-up page**

Create `src/app/(auth)/sign-up/[[...sign-up]]/page.tsx`:

```typescript
import { SignUp } from '@clerk/nextjs'

export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0f1117]">
      <SignUp />
    </div>
  )
}
```

- [ ] **4.5 — Create root redirect**

Replace `src/app/page.tsx`:

```typescript
import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/dashboard')
}
```

- [ ] **4.6 — Verify auth flow works**

```bash
npm run dev
```

- Visit http://localhost:3000 → should redirect to `/sign-in`
- Sign up for an account
- After sign-in → should land on `/dashboard` (will 404 for now — that's fine, auth is working)

- [ ] **4.7 — Commit**

```bash
git add src/middleware.ts src/app/layout.tsx src/app/page.tsx src/app/\(auth\)/
git commit -m "feat: add Clerk auth middleware, sign-in/up pages, root redirect"
```

**Acceptance criteria:** Unauthenticated visit to `/dashboard` redirects to `/sign-in`. Authenticated user lands on `/dashboard`.

**Common failure points:**
- Clerk keys missing from `.env.local` → blank page or 401 error.
- Organizations not enabled in Clerk dashboard → `orgId` will be `null` server-side. Enable it before proceeding.
- `clerkMiddleware` import path changed in Clerk v6 — use `@clerk/nextjs/server`, not `@clerk/nextjs`.

---

## Phase 5: Dashboard Shell

**Goal:** Authenticated users see a dark sidebar layout with all nav items. All pages render placeholder content. The UI matches the approved visual direction (dark, icon-only sidebar, indigo accent).

**Files:** `src/components/ui/button.tsx`, `src/components/ui/badge.tsx`, `src/components/layout/nav-item.tsx`, `src/components/layout/sidebar.tsx`, `src/components/layout/header.tsx`, `src/app/(dashboard)/layout.tsx`, plus 8 placeholder pages.

---

- [ ] **5.1 — Create Button component**

Create `src/components/ui/button.tsx`:

```typescript
import { clsx } from 'clsx'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'outline'
  size?: 'sm' | 'md'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center font-medium rounded-md transition-colors',
        {
          'bg-[#6366f1] text-white hover:bg-[#4f46e5]': variant === 'primary',
          'text-[#94a3b8] hover:text-white hover:bg-[#1e2130]': variant === 'ghost',
          'border border-[#2a2d3e] text-[#94a3b8] hover:border-[#6366f1] hover:text-white': variant === 'outline',
          'px-3 py-1.5 text-sm': size === 'sm',
          'px-4 py-2 text-sm': size === 'md',
        },
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
```

- [ ] **5.2 — Create Badge component**

Create `src/components/ui/badge.tsx`:

```typescript
import { clsx } from 'clsx'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'muted'
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        {
          'bg-[#1e1f3a] text-[#6366f1]': variant === 'default',
          'bg-[#052e16] text-[#10b981]': variant === 'success',
          'bg-[#2d1f00] text-[#f59e0b]': variant === 'warning',
          'bg-[#2d0f0f] text-[#ef4444]': variant === 'danger',
          'bg-[#1a1d2e] text-[#94a3b8]': variant === 'muted',
        },
      )}
    >
      {children}
    </span>
  )
}
```

- [ ] **5.3 — Create Input component**

Create `src/components/ui/input.tsx`:

```typescript
import { clsx } from 'clsx'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={clsx(
        'w-full bg-[#1a1d2e] border border-[#2a2d3e] text-[#e2e8f0] rounded-md px-3 py-2 text-sm',
        'placeholder:text-[#475569]',
        'focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]',
        className,
      )}
      {...props}
    />
  )
}
```

- [ ] **5.4 — Create NavItem component**

Create `src/components/layout/nav-item.tsx`:

```typescript
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'

interface NavItemProps {
  href: string
  icon: LucideIcon
  label: string
}

export function NavItem({ href, icon: Icon, label }: NavItemProps) {
  const pathname = usePathname()
  const isActive = pathname === href || pathname.startsWith(href + '/')

  return (
    <Link
      href={href}
      title={label}
      className={clsx(
        'group relative flex items-center justify-center w-10 h-10 rounded-lg transition-colors',
        {
          'bg-[#1e1f3a] text-[#6366f1]': isActive,
          'text-[#475569] hover:text-[#94a3b8] hover:bg-[#1a1d2e]': !isActive,
        },
      )}
    >
      <Icon size={18} />
      {/* Tooltip */}
      <span className="absolute left-full ml-2 px-2 py-1 bg-[#1a1d2e] text-[#e2e8f0] text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 border border-[#2a2d3e]">
        {label}
      </span>
    </Link>
  )
}
```

- [ ] **5.5 — Create Sidebar component**

Create `src/components/layout/sidebar.tsx`:

```typescript
import {
  LayoutDashboard,
  Users,
  Megaphone,
  GitBranch,
  Inbox,
  BarChart2,
  FileText,
  Settings,
} from 'lucide-react'
import { NavItem } from './nav-item'

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/campaigns', icon: Megaphone, label: 'Campaigns' },
  { href: '/sequences', icon: GitBranch, label: 'Sequences' },
  { href: '/inbox', icon: Inbox, label: 'Inbox' },
  { href: '/analytics', icon: BarChart2, label: 'Analytics' },
  { href: '/templates', icon: FileText, label: 'Templates' },
] as const

export function Sidebar() {
  return (
    <aside className="fixed left-0 top-0 h-full w-[52px] bg-[#13151c] border-r border-[#1e2130] flex flex-col items-center py-4 gap-2 z-40">
      {/* Logo mark */}
      <div className="w-8 h-8 bg-[#6366f1] rounded-lg flex items-center justify-center mb-4 flex-shrink-0">
        <span className="text-white text-xs font-bold">OS</span>
      </div>

      <nav className="flex flex-col gap-1 flex-1">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.href} {...item} />
        ))}
      </nav>

      {/* Settings pinned to bottom */}
      <NavItem href="/settings" icon={Settings} label="Settings" />
    </aside>
  )
}
```

- [ ] **5.6 — Create Header component**

Create `src/components/layout/header.tsx`:

```typescript
import { UserButton, OrganizationSwitcher } from '@clerk/nextjs'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="h-14 border-b border-[#1e2130] flex items-center justify-between px-6">
      <h1 className="text-[#e2e8f0] font-semibold text-base">{title}</h1>
      <div className="flex items-center gap-3">
        <OrganizationSwitcher
          appearance={{
            elements: {
              rootBox: 'text-sm',
              organizationSwitcherTrigger:
                'text-[#94a3b8] hover:text-white py-1 px-2 rounded-md hover:bg-[#1a1d2e]',
            },
          }}
        />
        <UserButton afterSignOutUrl="/sign-in" />
      </div>
    </header>
  )
}
```

- [ ] **5.7 — Create dashboard layout**

Create `src/app/(dashboard)/layout.tsx`:

```typescript
import { Sidebar } from '@/components/layout/sidebar'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#0f1117]">
      <Sidebar />
      <main className="ml-[52px] min-h-screen flex flex-col">
        {children}
      </main>
    </div>
  )
}
```

- [ ] **5.8 — Create placeholder pages**

Create `src/app/(dashboard)/dashboard/page.tsx`:

```typescript
import { Header } from '@/components/layout/header'

export default function DashboardPage() {
  return (
    <>
      <Header title="Dashboard" />
      <div className="flex-1 p-6">
        <p className="text-[#475569] text-sm">Dashboard — coming soon.</p>
      </div>
    </>
  )
}
```

Repeat for each remaining placeholder. Create these 6 files with only the title changed:

`src/app/(dashboard)/campaigns/page.tsx` — title: `"Campaigns"`
`src/app/(dashboard)/sequences/page.tsx` — title: `"Sequences"`
`src/app/(dashboard)/inbox/page.tsx` — title: `"Inbox"`
`src/app/(dashboard)/analytics/page.tsx` — title: `"Analytics"`
`src/app/(dashboard)/templates/page.tsx` — title: `"Templates"`
`src/app/(dashboard)/settings/page.tsx` — title: `"Settings"`

Each follows this exact pattern (change title string only):

```typescript
import { Header } from '@/components/layout/header'

export default function CampaignsPage() {
  return (
    <>
      <Header title="Campaigns" />
      <div className="flex-1 p-6">
        <p className="text-[#475569] text-sm">Campaigns — coming soon.</p>
      </div>
    </>
  )
}
```

- [ ] **5.9 — Verify dashboard shell**

```bash
npm run dev
```

Visit http://localhost:3000 after signing in. Expected: dark sidebar visible, all nav items show tooltips on hover, each route renders its title.

- [ ] **5.10 — Commit**

```bash
git add src/components/ src/app/\(dashboard\)/
git commit -m "feat: add dark dashboard shell with icon sidebar, header, placeholder pages"
```

**Acceptance criteria:** All 8 nav routes render without errors. Sidebar tooltips appear on hover. `OrganizationSwitcher` shows in header (may show empty if no org created yet in Clerk).

**Common failure points:**
- `'use client'` is required on `NavItem` because it uses `usePathname` — it is already included in 5.4.
- `OrganizationSwitcher` crashes if Organizations feature not enabled in Clerk dashboard.
- Tailwind v4 inline color values (e.g. `bg-[#0f1117]`) work without config — this is one of v4's improvements.

---

## Phase 6: Leads Feature Types & Schemas

**Goal:** Shared types and Zod validation schemas for the leads feature are defined before any server or UI code is written.

**Files:** `src/features/leads/types.ts`, `src/features/leads/schemas.ts`

---

- [ ] **6.1 — Write failing type test**

Create `src/features/leads/schemas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { CsvRowSchema, CreateLeadSchema } from './schemas'

describe('CsvRowSchema', () => {
  it('parses a valid CSV row', () => {
    const result = CsvRowSchema.safeParse({
      email: 'alice@acme.com',
      first_name: 'Alice',
      last_name: 'Smith',
      company: 'Acme',
      title: 'VP Sales',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.email).toBe('alice@acme.com')
      expect(result.data.first_name).toBe('Alice')
    }
  })

  it('rejects a row missing email', () => {
    const result = CsvRowSchema.safeParse({ first_name: 'Alice' })
    expect(result.success).toBe(false)
  })

  it('rejects an invalid email', () => {
    const result = CsvRowSchema.safeParse({ email: 'not-an-email' })
    expect(result.success).toBe(false)
  })
})

describe('CreateLeadSchema', () => {
  it('parses a valid lead creation input', () => {
    const result = CreateLeadSchema.safeParse({
      organizationId: 'org_123',
      email: 'bob@corp.com',
      firstName: 'Bob',
    })
    expect(result.success).toBe(true)
  })

  it('requires organizationId', () => {
    const result = CreateLeadSchema.safeParse({ email: 'bob@corp.com' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **6.2 — Run test to verify it fails**

```bash
npm test -- src/features/leads/schemas.test.ts
```

Expected: FAIL — `Cannot find module './schemas'`

- [ ] **6.3 — Create schemas**

Create `src/features/leads/schemas.ts`:

```typescript
import { z } from 'zod'
import { LeadSource, LeadStatus } from '@prisma/client'

// CSV row — maps to spreadsheet column headers (flexible casing handled by papaparse header option)
export const CsvRowSchema = z.object({
  email: z.string().email('Invalid email address'),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  linkedin_url: z.string().url().optional().or(z.literal('')),
  phone: z.string().optional(),
})

export type CsvRow = z.infer<typeof CsvRowSchema>

// Lead creation input — used by server functions
export const CreateLeadSchema = z.object({
  organizationId: z.string().min(1),
  importBatchId: z.string().optional(),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  company: z.string().optional(),
  title: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  phone: z.string().optional(),
  source: z.nativeEnum(LeadSource).default('CSV'),
  customFields: z.record(z.unknown()).optional(),
})

export type CreateLeadInput = z.infer<typeof CreateLeadSchema>
```

- [ ] **6.4 — Run test to verify it passes**

```bash
npm test -- src/features/leads/schemas.test.ts
```

Expected: PASS — 5 tests passing.

- [ ] **6.5 — Create types**

Create `src/features/leads/types.ts`:

```typescript
import type { Lead, ImportBatch } from '@prisma/client'

// DTO returned to UI — subset of the Prisma model
export type LeadDTO = Pick<
  Lead,
  | 'id'
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'company'
  | 'title'
  | 'source'
  | 'status'
  | 'score'
  | 'scoreReason'
  | 'scoredAt'
  | 'createdAt'
>

export type ImportBatchDTO = Pick<
  ImportBatch,
  'id' | 'fileName' | 'rowCount' | 'successCount' | 'errorCount' | 'status' | 'createdAt'
>

export interface ImportBatchResult {
  batch: ImportBatchDTO
  leads: LeadDTO[]
  errors: Array<{ row: number; message: string }>
}

export interface LeadScoreResult {
  leadId: string
  score: number
  reason: string
  success: boolean
}
```

- [ ] **6.6 — Commit**

```bash
git add src/features/leads/types.ts src/features/leads/schemas.ts src/features/leads/schemas.test.ts
git commit -m "feat: add leads feature types and Zod validation schemas"
```

**Acceptance criteria:** `npm test` passes all 5 schema tests. No TypeScript errors.

**Common failure points:**
- `z.nativeEnum(LeadSource)` requires `@prisma/client` to be generated first (Phase 2). If Prisma client is not generated, this import fails.
- `linkedin_url` in CsvRowSchema uses `or(z.literal(''))` to accept empty strings from CSV rows where the column exists but is blank.

---

## Phase 7: Server Logic — Import CSV & Score Leads

**Goal:** Three server functions handle the working slice: `importCsv` (parse + upsert), `scoreLeads` (AI scoring), `getLeads` (org-scoped list). All are pure server logic with typed inputs and outputs.

**Files:** `src/features/leads/server/import-csv.ts`, `src/features/leads/server/score-leads.ts`, `src/features/leads/server/get-leads.ts`

---

- [ ] **7.1 — Write failing tests for importCsv**

Create `src/features/leads/server/import-csv.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImportStatus, LeadSource } from '@prisma/client'

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    importBatch: {
      create: vi.fn(),
      update: vi.fn(),
    },
    lead: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
      importBatch: { create: vi.fn(), update: vi.fn() },
      lead: { upsert: vi.fn() },
    })),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { importCsv } from './import-csv'

const mockBatch = {
  id: 'batch-1',
  organizationId: 'org-1',
  fileName: 'leads.csv',
  rowCount: 0,
  successCount: 0,
  errorCount: 0,
  status: ImportStatus.PENDING,
  errorLog: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('importCsv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an ImportBatch and upserts leads from valid CSV', async () => {
    const csvContent = `email,first_name,last_name,company,title
alice@acme.com,Alice,Smith,Acme,VP Sales
bob@corp.com,Bob,Jones,Corp,CTO`

    const mockBatchCreate = vi.mocked(prisma.importBatch.create)
    const mockBatchUpdate = vi.mocked(prisma.importBatch.update)
    const mockLeadUpsert = vi.mocked(prisma.lead.upsert)

    mockBatchCreate.mockResolvedValueOnce(mockBatch)
    mockLeadUpsert.mockResolvedValue({
      id: 'lead-1',
      organizationId: 'org-1',
      importBatchId: 'batch-1',
      email: 'alice@acme.com',
      firstName: 'Alice',
      lastName: 'Smith',
      company: 'Acme',
      title: 'VP Sales',
      linkedinUrl: null,
      phone: null,
      source: LeadSource.CSV,
      status: 'NEW' as const,
      score: null,
      scoreReason: null,
      scoredAt: null,
      customFields: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    mockBatchUpdate.mockResolvedValue({ ...mockBatch, successCount: 2, status: ImportStatus.COMPLETED })

    const result = await importCsv({ organizationId: 'org-1', csvContent, fileName: 'leads.csv' })

    expect(mockBatchCreate).toHaveBeenCalledOnce()
    expect(mockLeadUpsert).toHaveBeenCalledTimes(2)
    expect(result.batch.successCount).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  it('records errors for invalid rows and continues', async () => {
    const csvContent = `email,first_name
not-an-email,Alice
valid@example.com,Bob`

    vi.mocked(prisma.importBatch.create).mockResolvedValueOnce(mockBatch)
    vi.mocked(prisma.lead.upsert).mockResolvedValue({
      id: 'lead-2',
      organizationId: 'org-1',
      importBatchId: 'batch-1',
      email: 'valid@example.com',
      firstName: 'Bob',
      lastName: null,
      company: null,
      title: null,
      linkedinUrl: null,
      phone: null,
      source: LeadSource.CSV,
      status: 'NEW' as const,
      score: null,
      scoreReason: null,
      scoredAt: null,
      customFields: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    vi.mocked(prisma.importBatch.update).mockResolvedValue({
      ...mockBatch,
      successCount: 1,
      errorCount: 1,
    })

    const result = await importCsv({ organizationId: 'org-1', csvContent, fileName: 'test.csv' })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.row).toBe(1)
  })
})
```

- [ ] **7.2 — Run test to verify it fails**

```bash
npm test -- src/features/leads/server/import-csv.test.ts
```

Expected: FAIL — `Cannot find module './import-csv'`

- [ ] **7.3 — Implement importCsv**

Create `src/features/leads/server/import-csv.ts`:

```typescript
import Papa from 'papaparse'
import { prisma } from '@/lib/db/prisma'
import { CsvRowSchema } from '../schemas'
import type { ImportBatchResult, LeadDTO } from '../types'

interface ImportCsvInput {
  organizationId: string
  csvContent: string
  fileName: string
}

export async function importCsv({
  organizationId,
  csvContent,
  fileName,
}: ImportCsvInput): Promise<ImportBatchResult> {
  // Parse CSV — header: true maps first row to keys
  const parsed = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  const rows = parsed.data
  const errors: ImportBatchResult['errors'] = []
  const leads: LeadDTO[] = []

  // Create ImportBatch record
  const batch = await prisma.importBatch.create({
    data: {
      organizationId,
      fileName,
      rowCount: rows.length,
      status: 'PROCESSING',
    },
  })

  // Process each row
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 1

    const validation = CsvRowSchema.safeParse(row)
    if (!validation.success) {
      errors.push({
        row: rowNumber,
        message: validation.error.errors.map((e) => e.message).join(', '),
      })
      continue
    }

    const data = validation.data

    try {
      const lead = await prisma.lead.upsert({
        where: {
          organizationId_email: {
            organizationId,
            email: data.email,
          },
        },
        update: {
          firstName: data.first_name ?? undefined,
          lastName: data.last_name ?? undefined,
          company: data.company ?? undefined,
          title: data.title ?? undefined,
          linkedinUrl: data.linkedin_url || undefined,
          phone: data.phone ?? undefined,
          importBatchId: batch.id,
        },
        create: {
          organizationId,
          importBatchId: batch.id,
          email: data.email,
          firstName: data.first_name,
          lastName: data.last_name,
          company: data.company,
          title: data.title,
          linkedinUrl: data.linkedin_url || undefined,
          phone: data.phone,
          source: 'CSV',
        },
      })

      leads.push({
        id: lead.id,
        email: lead.email,
        firstName: lead.firstName,
        lastName: lead.lastName,
        company: lead.company,
        title: lead.title,
        source: lead.source,
        status: lead.status,
        score: lead.score,
        scoreReason: lead.scoreReason,
        scoredAt: lead.scoredAt,
        createdAt: lead.createdAt,
      })
    } catch (err) {
      errors.push({
        row: rowNumber,
        message: err instanceof Error ? err.message : 'Failed to upsert lead',
      })
    }
  }

  // Update batch with final counts
  const updatedBatch = await prisma.importBatch.update({
    where: { id: batch.id },
    data: {
      successCount: leads.length,
      errorCount: errors.length,
      status: errors.length === rows.length ? 'FAILED' : 'COMPLETED',
      errorLog: errors.length > 0 ? errors : undefined,
    },
  })

  return {
    batch: {
      id: updatedBatch.id,
      fileName: updatedBatch.fileName,
      rowCount: updatedBatch.rowCount,
      successCount: updatedBatch.successCount,
      errorCount: updatedBatch.errorCount,
      status: updatedBatch.status,
      createdAt: updatedBatch.createdAt,
    },
    leads,
    errors,
  }
}
```

- [ ] **7.4 — Run importCsv tests to verify they pass**

```bash
npm test -- src/features/leads/server/import-csv.test.ts
```

Expected: PASS — 2 tests passing.

- [ ] **7.5 — Write failing test for scoreLeads**

Create `src/features/leads/server/score-leads.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    promptTemplate: { findFirst: vi.fn() },
    lead: { update: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/ai', () => ({
  getAIProvider: vi.fn(() => ({
    scoreLeads: vi.fn(),
  })),
}))

import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { scoreLeads } from './score-leads'

describe('scoreLeads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scores leads and persists results', async () => {
    const mockLeads = [
      { id: 'lead-1', email: 'a@test.com', firstName: 'A', lastName: null, company: 'Acme', title: 'VP' },
    ]
    const mockTemplate = {
      id: 'tpl-1',
      body: 'Score this lead 0-100 based on ICP fit.',
    }

    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(mockLeads as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(mockTemplate as never)

    const mockProvider = { scoreLeads: vi.fn().mockResolvedValueOnce([
      { leadId: 'lead-1', score: 80, reason: 'Senior title at known company' },
    ])}
    vi.mocked(getAIProvider).mockReturnValue(mockProvider)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    const results = await scoreLeads({ organizationId: 'org-1', leadIds: ['lead-1'] })

    expect(mockProvider.scoreLeads).toHaveBeenCalledOnce()
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1' },
        data: expect.objectContaining({ score: 80 }),
      }),
    )
    expect(results[0]).toMatchObject({ leadId: 'lead-1', score: 80, success: true })
  })

  it('uses fallback prompt when no PromptTemplate exists', async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([
      { id: 'lead-2', email: 'b@test.com', firstName: null, lastName: null, company: null, title: null },
    ] as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(null)

    const mockProvider = { scoreLeads: vi.fn().mockResolvedValueOnce([
      { leadId: 'lead-2', score: 40, reason: 'Limited info available' },
    ])}
    vi.mocked(getAIProvider).mockReturnValue(mockProvider)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    await scoreLeads({ organizationId: 'org-1', leadIds: ['lead-2'] })

    expect(mockProvider.scoreLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('ICP'), // fallback prompt contains 'ICP'
    )
  })
})
```

- [ ] **7.6 — Run test to verify it fails**

```bash
npm test -- src/features/leads/server/score-leads.test.ts
```

Expected: FAIL — `Cannot find module './score-leads'`

- [ ] **7.7 — Implement scoreLeads**

Create `src/features/leads/server/score-leads.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import type { LeadScoreResult } from '../types'

const FALLBACK_SCORING_PROMPT = `You are a B2B sales intelligence assistant. Score each lead from 0 to 100 based on their likely fit as an ICP (Ideal Customer Profile) for an outbound sales campaign.

Consider:
- Job title seniority (VP, Director, C-level = higher score)
- Company presence (known company name = higher score)
- Email domain quality (personal domains like gmail.com = lower score)
- Completeness of profile (more fields filled = higher score)

Be consistent. Return only valid JSON.`

interface ScoreLeadsInput {
  organizationId: string
  leadIds: string[]
}

export async function scoreLeads({
  organizationId,
  leadIds,
}: ScoreLeadsInput): Promise<LeadScoreResult[]> {
  // Fetch leads — always org-scoped
  const leads = await prisma.lead.findMany({
    where: {
      id: { in: leadIds },
      organizationId,
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      title: true,
    },
  })

  if (leads.length === 0) return []

  // Fetch active prompt template (fall back to built-in if none configured)
  const template = await prisma.promptTemplate.findFirst({
    where: {
      organizationId,
      promptType: 'LEAD_SCORING',
      isActive: true,
    },
  })

  const prompt = template?.body ?? FALLBACK_SCORING_PROMPT

  // Score via AI provider
  const provider = getAIProvider()
  const scores = await provider.scoreLeads(leads, prompt)

  // Persist each score
  const results: LeadScoreResult[] = []

  for (const score of scores) {
    try {
      await prisma.lead.update({
        where: { id: score.leadId },
        data: {
          score: score.score,
          scoreReason: score.reason,
          scoredAt: new Date(),
        },
      })
      results.push({ ...score, success: true })
    } catch (err) {
      results.push({
        leadId: score.leadId,
        score: score.score,
        reason: score.reason,
        success: false,
      })
    }
  }

  return results
}
```

- [ ] **7.8 — Run scoreLeads tests to verify they pass**

```bash
npm test -- src/features/leads/server/score-leads.test.ts
```

Expected: PASS — 2 tests passing.

- [ ] **7.9 — Create getLeads**

Create `src/features/leads/server/get-leads.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { LeadDTO } from '../types'

interface GetLeadsInput {
  organizationId: string
  limit?: number
  offset?: number
}

export async function getLeads({
  organizationId,
  limit = 50,
  offset = 0,
}: GetLeadsInput): Promise<{ leads: LeadDTO[]; total: number }> {
  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where: { organizationId },
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: limit,
      skip: offset,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        company: true,
        title: true,
        source: true,
        status: true,
        score: true,
        scoreReason: true,
        scoredAt: true,
        createdAt: true,
      },
    }),
    prisma.lead.count({ where: { organizationId } }),
  ])

  return { leads, total }
}
```

- [ ] **7.10 — Commit**

```bash
git add src/features/leads/server/
git commit -m "feat: add importCsv, scoreLeads, getLeads server functions with tests"
```

**Acceptance criteria:** `npm test` passes all 4 server function tests. No TypeScript errors.

**Common failure points:**
- `Papa.parse` default import — PapaParse's ESM export may need `import Papa from 'papaparse'` vs `import * as Papa`. If you see `Papa.parse is not a function`, use `import * as Papa from 'papaparse'`.
- `prisma.lead.upsert` with `organizationId_email` compound key must match the `@@unique([organizationId, email])` in the schema exactly — field names are concatenated with `_`.

---

## Phase 8: API Route Handler

**Goal:** `POST /api/leads/import` accepts a CSV file, calls `importCsv` then `scoreLeads`, and returns the result. Handler is thin — no business logic.

**Files:** `src/app/api/leads/import/route.ts`

---

- [ ] **8.1 — Create the route handler**

Create `src/app/api/leads/import/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { importCsv } from '@/features/leads/server/import-csv'
import { scoreLeads } from '@/features/leads/server/score-leads'

export async function POST(request: Request) {
  const { orgId } = await auth()

  if (!orgId) {
    return NextResponse.json(
      { error: 'No active organization. Select an organization to continue.' },
      { status: 403 },
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!file.name.endsWith('.csv')) {
    return NextResponse.json({ error: 'File must be a .csv' }, { status: 400 })
  }

  const csvContent = await file.text()

  if (!csvContent.trim()) {
    return NextResponse.json({ error: 'CSV file is empty' }, { status: 400 })
  }

  // Import leads
  const importResult = await importCsv({
    organizationId: orgId,
    csvContent,
    fileName: file.name,
  })

  // Score imported leads (fire-and-forget errors — import already succeeded)
  let scoreResults = []
  if (importResult.leads.length > 0) {
    try {
      scoreResults = await scoreLeads({
        organizationId: orgId,
        leadIds: importResult.leads.map((l) => l.id),
      })
    } catch (err) {
      console.error('Scoring failed after import:', err)
      // Import succeeded — return result with scoring failure noted
      return NextResponse.json({
        ...importResult,
        scoringError: 'Scoring failed — leads were imported but not yet scored.',
      })
    }
  }

  return NextResponse.json({ ...importResult, scores: scoreResults })
}
```

- [ ] **8.2 — Verify route works with curl**

With the dev server running and a valid session cookie, test the endpoint directly. Create a test CSV file first:

```bash
cat > /tmp/test-leads.csv << 'EOF'
email,first_name,last_name,company,title
alice@acme.com,Alice,Smith,Acme Inc,VP of Sales
bob@techcorp.com,Bob,Jones,TechCorp,CTO
EOF
```

Then test (replace `YOUR_SESSION_COOKIE` — get it from browser DevTools → Application → Cookies → `__session`):

```bash
curl -X POST http://localhost:3000/api/leads/import \
  -F "file=@/tmp/test-leads.csv" \
  -H "Cookie: __session=YOUR_SESSION_COOKIE" \
  | jq .
```

Expected response:
```json
{
  "batch": { "successCount": 2, "errorCount": 0, "status": "COMPLETED" },
  "leads": [...],
  "errors": [],
  "scores": [{ "leadId": "...", "score": 75, "success": true }, ...]
}
```

- [ ] **8.3 — Commit**

```bash
git add src/app/api/leads/import/route.ts
git commit -m "feat: add POST /api/leads/import route handler"
```

**Acceptance criteria:** `POST /api/leads/import` with a valid CSV returns 200 with leads and scores. Missing `orgId` returns 403. Non-CSV file returns 400.

**Common failure points:**
- `auth()` must be awaited in Next.js 15 — `const { orgId } = await auth()`.
- `orgId` is `null` if user has no active organization selected in Clerk. User must create/select an org in the `OrganizationSwitcher` in the header before importing.
- OpenAI API call fails if `OPENAI_API_KEY` is not set — the route returns `scoringError` in the response body, not a 500, so imports don't fail due to AI issues.

---

## Phase 9: Leads UI — Upload + Table

**Goal:** The `/leads` page has a working CSV upload button and a table showing imported leads with their AI scores. Uploading a CSV triggers the API, refreshes the table.

**Files:** `src/features/leads/components/csv-upload-form.tsx`, `src/features/leads/components/leads-table.tsx`, `src/app/(dashboard)/leads/page.tsx`

---

- [ ] **9.1 — Create CsvUploadForm component**

Create `src/features/leads/components/csv-upload-form.tsx`:

```typescript
'use client'

import { useState, useRef } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ImportBatchResult } from '../types'

interface CsvUploadFormProps {
  onSuccess: (result: ImportBatchResult) => void
}

export function CsvUploadForm({ onSuccess }: CsvUploadFormProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/leads/import', {
        method: 'POST',
        body: formData,
      })

      const data = (await response.json()) as ImportBatchResult & { error?: string }

      if (!response.ok) {
        setError(data.error ?? 'Import failed')
        return
      }

      onSuccess(data)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setUploading(false)
      // Reset input so same file can be re-uploaded
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
        id="csv-upload"
      />
      <label htmlFor="csv-upload">
        <Button
          as="span"
          variant="primary"
          size="sm"
          disabled={uploading}
          className="cursor-pointer"
        >
          <Upload size={14} className="mr-2" />
          {uploading ? 'Importing...' : 'Import CSV'}
        </Button>
      </label>
      {error && (
        <span className="text-[#ef4444] text-sm">{error}</span>
      )}
    </div>
  )
}
```

- [ ] **9.2 — Fix Button to support `as` prop**

The upload label trick requires `Button` to render as a `<span>`. Update `src/components/ui/button.tsx` to add an `as` prop:

```typescript
import { clsx } from 'clsx'

type ButtonBaseProps = {
  variant?: 'primary' | 'ghost' | 'outline'
  size?: 'sm' | 'md'
  className?: string
  children: React.ReactNode
  disabled?: boolean
}

type ButtonAsButton = ButtonBaseProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & { as?: 'button' }

type ButtonAsSpan = ButtonBaseProps &
  React.HTMLAttributes<HTMLSpanElement> & { as: 'span' }

type ButtonProps = ButtonAsButton | ButtonAsSpan

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  as: Tag = 'button',
  ...props
}: ButtonProps) {
  const classes = clsx(
    'inline-flex items-center justify-center font-medium rounded-md transition-colors',
    {
      'bg-[#6366f1] text-white hover:bg-[#4f46e5]': variant === 'primary',
      'text-[#94a3b8] hover:text-white hover:bg-[#1e2130]': variant === 'ghost',
      'border border-[#2a2d3e] text-[#94a3b8] hover:border-[#6366f1] hover:text-white': variant === 'outline',
      'px-3 py-1.5 text-sm': size === 'sm',
      'px-4 py-2 text-sm': size === 'md',
      'opacity-50 cursor-not-allowed': (props as { disabled?: boolean }).disabled,
    },
    className,
  )

  // @ts-expect-error — polymorphic component, tag is safe
  return <Tag className={classes} {...props}>{children}</Tag>
}
```

- [ ] **9.3 — Create LeadsTable component**

Create `src/features/leads/components/leads-table.tsx`:

```typescript
import { Badge } from '@/components/ui/badge'
import type { LeadDTO } from '../types'

interface LeadsTableProps {
  leads: LeadDTO[]
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-[#475569] text-xs">—</span>
  const variant =
    score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger'
  return <Badge variant={variant}>{score}</Badge>
}

function StatusBadge({ status }: { status: LeadDTO['status'] }) {
  const variantMap: Record<LeadDTO['status'], 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
    NEW: 'default',
    CONTACTED: 'warning',
    REPLIED: 'success',
    BOUNCED: 'danger',
    UNSUBSCRIBED: 'danger',
    CONVERTED: 'success',
  }
  return <Badge variant={variantMap[status]}>{status}</Badge>
}

export function LeadsTable({ leads }: LeadsTableProps) {
  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[#475569] text-sm">No leads yet.</p>
        <p className="text-[#334155] text-xs mt-1">Import a CSV to get started.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e2130]">
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Name</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Company</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Title</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Score</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Score Reason</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.id}
              className="border-b border-[#1a1d2e] hover:bg-[#1a1d2e] transition-colors"
            >
              <td className="py-3 px-4">
                <div className="text-[#e2e8f0] font-medium">
                  {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'}
                </div>
                <div className="text-[#475569] text-xs">{lead.email}</div>
              </td>
              <td className="py-3 px-4 text-[#94a3b8]">{lead.company ?? '—'}</td>
              <td className="py-3 px-4 text-[#94a3b8]">{lead.title ?? '—'}</td>
              <td className="py-3 px-4"><StatusBadge status={lead.status} /></td>
              <td className="py-3 px-4"><ScoreBadge score={lead.score} /></td>
              <td className="py-3 px-4 text-[#475569] text-xs hidden lg:table-cell max-w-xs truncate">
                {lead.scoreReason ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **9.4 — Create the Leads page**

Replace `src/app/(dashboard)/leads/page.tsx`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { LeadsPageClient } from './leads-client'
import { getLeads } from '@/features/leads/server/get-leads'

export default async function LeadsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const { leads, total } = await getLeads({ organizationId: orgId })

  return (
    <>
      <Header title="Leads" />
      <div className="flex-1 p-6">
        <LeadsPageClient initialLeads={leads} initialTotal={total} />
      </div>
    </>
  )
}
```

- [ ] **9.5 — Create the Leads client component**

Create `src/app/(dashboard)/leads/leads-client.tsx`:

```typescript
'use client'

import { useState } from 'react'
import { CsvUploadForm } from '@/features/leads/components/csv-upload-form'
import { LeadsTable } from '@/features/leads/components/leads-table'
import type { LeadDTO, ImportBatchResult } from '@/features/leads/types'

interface LeadsPageClientProps {
  initialLeads: LeadDTO[]
  initialTotal: number
}

export function LeadsPageClient({ initialLeads, initialTotal }: LeadsPageClientProps) {
  const [leads, setLeads] = useState<LeadDTO[]>(initialLeads)
  const [total, setTotal] = useState(initialTotal)
  const [lastBatch, setLastBatch] = useState<ImportBatchResult['batch'] | null>(null)

  function handleImportSuccess(result: ImportBatchResult) {
    // Prepend new leads, keeping list fresh without a full page reload
    setLeads((prev) => {
      const existingIds = new Set(prev.map((l) => l.id))
      const newLeads = result.leads.filter((l) => !existingIds.has(l.id))
      return [...newLeads, ...prev]
    })
    setTotal((prev) => prev + result.batch.successCount)
    setLastBatch(result.batch)
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[#94a3b8] text-sm">
            {total.toLocaleString()} lead{total !== 1 ? 's' : ''}
          </span>
          {lastBatch && (
            <span className="text-[#10b981] text-xs">
              + {lastBatch.successCount} imported
            </span>
          )}
        </div>
        <CsvUploadForm onSuccess={handleImportSuccess} />
      </div>

      {/* Table */}
      <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
        <LeadsTable leads={leads} />
      </div>
    </div>
  )
}
```

- [ ] **9.6 — Full end-to-end test in browser**

```bash
npm run dev
```

1. Sign in → navigate to `/leads`
2. Click "Import CSV" → select a CSV file with `email`, `first_name`, `last_name`, `company`, `title` columns
3. Expected: leads appear in the table within a few seconds, with score badges (green ≥70, amber 40-69, red <40)
4. Verify in Prisma Studio (`npx prisma studio`) that `leads` and `import_batches` tables have rows

- [ ] **9.7 — Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **9.8 — Final commit**

```bash
git add src/features/leads/components/ src/app/\(dashboard\)/leads/
git commit -m "feat: add leads UI with CSV upload form and scored leads table"
```

**Acceptance criteria:** Uploading a valid CSV shows leads in the table with score badges. Empty state shows on first visit. Score colors reflect AI output. `npm test` passes all tests.

**Common failure points:**
- `auth()` in a Server Component must be `await`-ed — already handled in 9.4.
- `leads-client.tsx` must be in `src/app/(dashboard)/leads/` alongside `page.tsx` — it's a route-collocated client component.
- Scores appear as `0` if `OPENAI_API_KEY` is missing or invalid — check the server console for scoring errors.
- The `as` prop on `Button` used in `CsvUploadForm` requires the polymorphic update from 9.2 — ensure that's done before 9.1.

---

## Self-Review — Spec Coverage Check

| Spec requirement | Covered in |
|---|---|
| Next.js App Router, TypeScript strict | Phase 1 |
| Tailwind CSS v4 | Phase 1 |
| Prisma + PostgreSQL, full v1 schema | Phase 2 |
| .env.example with all keys | Phase 2 |
| Clerk auth, Organizations, middleware | Phase 4 |
| Dashboard layout — dark sidebar, icon-only | Phase 5 |
| All 8 placeholder routes | Phase 5 |
| `lib/db/prisma.ts` singleton | Phase 3 |
| `lib/ai` abstraction with OpenAI adapter | Phase 3 |
| `features/leads/schemas.ts` (Zod) | Phase 6 |
| `features/leads/types.ts` | Phase 6 |
| `features/leads/server/import-csv.ts` | Phase 7 |
| `features/leads/server/score-leads.ts` | Phase 7 |
| `features/leads/server/get-leads.ts` | Phase 7 |
| Thin route handler, no business logic | Phase 8 |
| All queries organization-scoped | Phases 7, 8 |
| CSV upload UI | Phase 9 |
| Leads table with score display | Phase 9 |
| Tests for server functions | Phases 3, 6, 7 |

All spec requirements covered. No gaps.

---

## Copy-Paste Coding Prompts

Use these prompts to implement each phase in a fresh Claude session.

---

### Prompt — Phase 1: Bootstrap

```
You are implementing Phase 1 of OutboundOS — a Next.js 15 SaaS app.
Working directory: /Users/justintud/Desktop/Coding Projects/outboundos-site (empty)

Tasks:
1. Scaffold with: npx create-next-app@latest . --typescript --eslint --app --src-dir --no-import-alias --tailwind --yes
2. Install: @clerk/nextjs @prisma/client zod openai papaparse lucide-react clsx @sendgrid/mail
   Dev deps: prisma @types/papaparse vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom @types/node
3. Upgrade Tailwind to v4: uninstall tailwindcss @tailwindcss/postcss autoprefixer, install tailwindcss@^4 @tailwindcss/postcss
4. Update postcss.config.mjs to use { plugins: { "@tailwindcss/postcss": {} } }
5. Replace globals.css with: @import "tailwindcss"; plus CSS vars for dark theme (--background: #0f1117, --accent: #6366f1, etc.)
6. Add "strict": true and "noUncheckedIndexedAccess": true to tsconfig.json compilerOptions
7. Create vitest.config.ts with node environment, globals: true, @ alias to ./src
8. Add "test": "vitest run" and "test:watch": "vitest" to package.json scripts
9. Run npm run dev to verify — must start cleanly
10. git init and commit

Follow the plan at docs/superpowers/plans/2026-03-31-outboundos-foundation.md Phase 1 exactly.
```

---

### Prompt — Phase 2: Prisma Schema

```
You are implementing Phase 2 of OutboundOS — Prisma schema and migration.
Working directory: /Users/justintud/Desktop/Coding Projects/outboundos-site
Phase 1 (Next.js bootstrap) is complete.

Tasks:
1. Create .env.example with all required keys (DATABASE_URL, Clerk keys, OPENAI_API_KEY, OPENAI_MODEL, SendGrid keys, NEXT_PUBLIC_APP_URL)
2. cp .env.example .env.local and fill in DATABASE_URL (postgres://postgres:postgres@localhost:5432/outboundos), Clerk keys, OpenAI key
3. Ensure .env.local and .superpowers/ are in .gitignore
4. Run: npx prisma init --datasource-provider postgresql
5. Write the full schema to prisma/schema.prisma — all 14 models and 9 enums as specified in the design doc at docs/superpowers/specs/2026-03-31-outboundos-design.md
6. Run: npx prisma migrate dev --name init
7. Run: npx prisma generate
8. Verify in Prisma Studio: npx prisma studio — confirm all tables exist
9. Commit

The complete schema is in docs/superpowers/specs/2026-03-31-outboundos-design.md.
Follow the plan at docs/superpowers/plans/2026-03-31-outboundos-foundation.md Phase 2 exactly.
```

---

### Prompt — Phase 3: Lib Infrastructure

```
You are implementing Phase 3 of OutboundOS — lib infrastructure.
Working directory: /Users/justintud/Desktop/Coding Projects/outboundos-site
Phases 1–2 are complete. Prisma client is generated.

Tasks:
1. Create src/lib/db/prisma.ts — Prisma singleton using globalThis pattern
2. Create src/lib/ai/provider.ts — AIProvider interface with LeadScoreInput, LeadScoreOutput types
3. Write failing test at src/lib/ai/openai.test.ts — run npm test to confirm FAIL
4. Create src/lib/ai/openai.ts — OpenAIProvider class implementing AIProvider
5. Run tests — confirm 2 passing
6. Create src/lib/ai/router.ts — getAIProvider() reads OPENAI_API_KEY and returns OpenAIProvider instance (singleton)
7. Create src/lib/ai/index.ts — re-exports getAIProvider, AIProvider, LeadScoreInput, LeadScoreOutput
8. Commit

Follow the plan at docs/superpowers/plans/2026-03-31-outboundos-foundation.md Phase 3 exactly.
All code is in that plan — copy it precisely.
```

---

### Prompt — Phase 4: Auth

```
You are implementing Phase 4 of OutboundOS — Clerk auth.
Working directory: /Users/justintud/Desktop/Coding Projects/outboundos-site
Phases 1–3 are complete.

Prerequisites:
- Clerk app created at clerk.com with Organizations feature enabled
- NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY set in .env.local

Tasks:
1. Create src/middleware.ts — clerkMiddleware protecting all routes except /sign-in, /sign-up, /api/webhooks
2. Update src/app/layout.tsx — wrap with ClerkProvider
3. Create src/app/(auth)/sign-in/[[...sign-in]]/page.tsx — centered SignIn component on dark background
4. Create src/app/(auth)/sign-up/[[...sign-up]]/page.tsx — centered SignUp component on dark background
5. Replace src/app/page.tsx — redirect('/dashboard')
6. Test: npm run dev, visit localhost:3000, confirm redirect to /sign-in, sign in, confirm redirect to /dashboard (will 404 — that's fine)
7. Commit

Follow the plan at docs/superpowers/plans/2026-03-31-outboundos-foundation.md Phase 4 exactly.
```

---

### Prompt — Phase 5: Dashboard Shell

```
You are implementing Phase 5 of OutboundOS — dashboard layout and shell pages.
Working directory: /Users/justintud/Desktop/Coding Projects/outboundos-site
Phases 1–4 are complete.

Tasks:
1. Create src/components/ui/button.tsx — Button with primary/ghost/outline variants
2. Create src/components/ui/badge.tsx — Badge with default/success/warning/danger/muted variants
3. Create src/components/ui/input.tsx — styled Input
4. Create src/components/layout/nav-item.tsx — 'use client', uses usePathname for active state, shows tooltip on hover, 52px icon-only style
5. Create src/components/layout/sidebar.tsx — fixed 52px dark sidebar with OS logo mark and nav items using lucide-react icons
6. Create src/components/layout/header.tsx — 56px header with page title, OrganizationSwitcher, UserButton
7. Create src/app/(dashboard)/layout.tsx — Sidebar + main content area with ml-[52px]
8. Create src/app/(dashboard)/dashboard/page.tsx — placeholder with Header title="Dashboard"
9. Create 6 more placeholder pages: campaigns, sequences, inbox, analytics, templates, settings (same pattern, different titles)
10. Test: all nav items route correctly, sidebar tooltips show, Clerk components render
11. Commit

Visual direction: dark (#0f1117 bg, #13151c sidebar, #6366f1 accent). Reference Apollo/Clay.
Follow the plan at docs/superpowers/plans/2026-03-31-outboundos-foundation.md Phase 5 exactly.
```

---

### Prompt — Phase 6: Leads Types & Schemas

```
You are implementing Phase 6 of OutboundOS — leads feature types and schemas.
Working directory: /Users/justintud/Desktop/Coding Projects/outboundos-site
Phases 1–5 are complete.

Tasks:
1. Write failing test at src/features/leads/schemas.test.ts (5 tests for CsvRowSchema and CreateLeadSchema)
2. Run npm test — confirm FAIL
3. Create src/features/leads/schemas.ts — CsvRowSchema (Zod, maps CSV headers), CreateLeadSchema (Zod, for server functions)
4. Run npm test — confirm 5 tests pass
5. Create src/features/leads/types.ts — LeadDTO, ImportBatchDTO, ImportBatchResult, LeadScoreResult
6. Commit

CsvRowSchema fields: email (required, .email()), first_name, last_name, company, title, linkedin_url, phone (all optional).
LeadDTO is a Pick of the Prisma Lead model (id, email, firstName, lastName, company, title, source, status, score, scoreReason, scoredAt, createdAt).

Follow the plan at docs/superpowers/plans/2026-03-31-outboundos-foundation.md Phase 6 exactly.
```

---

### Prompt — Phase 7: Server Logic

```
You are implementing Phase 7 of OutboundOS — importCsv, scoreLeads, getLeads server functions.
Working directory: /Users/justintud/Desktop/Coding Projects/outboundos-site
Phases 1–6 are complete.

Tasks:
1. Write failing test at src/features/leads/server/import-csv.test.ts (2 tests — mocks prisma)
2. Run npm test — confirm FAIL
3. Create src/features/leads/server/import-csv.ts:
   - Accepts { organizationId, csvContent, fileName }
   - Uses PapaParse to parse CSV with header:true
   - Creates ImportBatch with status PROCESSING
   - Validates each row with CsvRowSchema
   - Upserts leads via prisma.lead.upsert using organizationId_email compound key
   - Updates ImportBatch with counts and status COMPLETED/FAILED
   - Returns ImportBatchResult
4. Run tests — confirm 2 passing
5. Write failing test at src/features/leads/server/score-leads.test.ts (2 tests — mocks prisma + AI)
6. Run npm test -- score-leads — confirm FAIL
7. Create src/features/leads/server/score-leads.ts:
   - Accepts { organizationId, leadIds }
   - Fetches leads (org-scoped, selected fields only)
   - Fetches active PromptTemplate for LEAD_SCORING (falls back to built-in prompt if none)
   - Calls getAIProvider().scoreLeads()
   - Persists score, scoreReason, scoredAt to each lead
   - Returns LeadScoreResult[]
8. Run tests — confirm 4 passing
9. Create src/features/leads/server/get-leads.ts — getLeads({ organizationId, limit, offset }), returns { leads: LeadDTO[], total: number }, ordered by score desc then createdAt desc
10. Commit

Follow the plan at docs/superpowers/plans/2026-03-31-outboundos-foundation.md Phase 7 exactly.
```

---

### Prompt — Phase 8: Route Handler

```
You are implementing Phase 8 of OutboundOS — the import route handler.
Working directory: /Users/justintud/Desktop/Coding Projects/outboundos-site
Phases 1–7 are complete.

Tasks:
1. Create src/app/api/leads/import/route.ts:
   - POST handler only
   - await auth() to get orgId — return 403 if missing
   - Parse formData, get file — return 400 if missing or not .csv
   - Read file.text() for CSV content
   - Call importCsv({ organizationId: orgId, csvContent, fileName: file.name })
   - If leads were imported, call scoreLeads({ organizationId: orgId, leadIds })
   - Return NextResponse.json with the import result and scores
   - If scoring fails, return import result with scoringError field (do not return 500)
2. Test with curl using a test CSV file (see plan for curl command)
3. Commit

Route handler must be thin: parse → call → respond. No business logic in the handler.
Follow the plan at docs/superpowers/plans/2026-03-31-outboundos-foundation.md Phase 8 exactly.
```

---

### Prompt — Phase 9: Leads UI

```
You are implementing Phase 9 of OutboundOS — the leads page UI.
Working directory: /Users/justintud/Desktop/Coding Projects/outboundos-site
Phases 1–8 are complete.

Tasks:
1. Create src/features/leads/components/csv-upload-form.tsx:
   - 'use client'
   - Hidden file input, styled label as upload button
   - POSTs FormData to /api/leads/import
   - Shows uploading state, calls onSuccess(result) on completion, shows error string on failure
2. Update src/components/ui/button.tsx to support `as` prop (polymorphic — 'button' | 'span')
3. Create src/features/leads/components/leads-table.tsx:
   - Shows name (firstName + lastName), email, company, title, status badge, score badge, scoreReason
   - ScoreBadge: green ≥70, amber 40-69, red <40 (uses Badge component)
   - StatusBadge: maps LeadStatus to badge variants
   - Empty state: "No leads yet. Import a CSV to get started."
4. Replace src/app/(dashboard)/leads/page.tsx:
   - Server Component, await auth() for orgId, redirect to /dashboard if no orgId
   - Call getLeads({ organizationId: orgId }) to get initial data
   - Render Header title="Leads" + LeadsPageClient
5. Create src/app/(dashboard)/leads/leads-client.tsx:
   - 'use client'
   - State: leads, total, lastBatch
   - handleImportSuccess: prepends new leads (deduped by id), increments total, sets lastBatch
   - Renders: toolbar with lead count + "+N imported" flash + CsvUploadForm, then leads table in a card
6. End-to-end test: import a CSV, verify leads appear with score badges in table, check Prisma Studio
7. Run npm test — all tests pass
8. Commit

Follow the plan at docs/superpowers/plans/2026-03-31-outboundos-foundation.md Phase 9 exactly.
```
