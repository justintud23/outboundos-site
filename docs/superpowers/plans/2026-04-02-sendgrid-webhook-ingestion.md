# SendGrid Webhook Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest SendGrid event webhooks into `MessageEvent` records, scoped to the correct organization, idempotently.

**Architecture:** The route at `/api/webhooks/sendgrid` receives a JSON array of SendGrid events, hands it to `ingestWebhookEvents` in `src/features/events/server/`, which maps each event to a `MessageEvent` row. Idempotency is enforced via a unique `sgEventId` column — duplicate deliveries upsert with a no-op `update: {}`. Organization scope is derived from the `OutboundMessage` found by `draftId` (injected as a SendGrid customArg at send time). Route always returns 200 to prevent SendGrid retries on application errors.

**Tech Stack:** Prisma v7, Next.js 16 App Router, SendGrid Event Webhooks, Vitest v4

---

## File Map

| Action | Path |
|--------|------|
| Modify | `prisma/schema.prisma` — add `sgEventId String? @unique` to `MessageEvent` |
| Create | `prisma/migrations/20260402000000_add_sg_event_id_message_event/migration.sql` |
| Create | `src/features/events/types.ts` |
| Create | `src/features/events/server/map-event-type.ts` |
| Create | `src/features/events/server/map-event-type.test.ts` |
| Create | `src/features/events/server/ingest-webhook-events.ts` |
| Create | `src/features/events/server/ingest-webhook-events.test.ts` |
| Create | `src/app/api/webhooks/sendgrid/route.ts` |

---

## Task 1: Schema migration — add sgEventId to MessageEvent

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260402000000_add_sg_event_id_message_event/migration.sql`

- [ ] **Step 1: Add `sgEventId` field to `MessageEvent` in schema.prisma**

In `prisma/schema.prisma`, inside the `MessageEvent` model, add after `rawPayload Json`:

```prisma
model MessageEvent {
  id                String          @id @default(cuid())
  organizationId    String
  outboundMessageId String
  outboundMessage   OutboundMessage @relation(fields: [outboundMessageId], references: [id], onDelete: Cascade)

  sgEventId         String?         @unique
  eventType         MessageEventType
  providerEventType String?
  providerTimestamp DateTime?
  rawPayload        Json

  createdAt DateTime @default(now())

  @@index([outboundMessageId])
  @@index([organizationId])
  @@index([organizationId, eventType])
  @@map("message_events")
}
```

- [ ] **Step 2: Create migration SQL file**

Create file `prisma/migrations/20260402000000_add_sg_event_id_message_event/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "message_events" ADD COLUMN "sgEventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "message_events_sgEventId_key" ON "message_events"("sgEventId");
```

- [ ] **Step 3: Run prisma generate**

```bash
npx prisma generate
```

Expected: no errors, Prisma client regenerated.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260402000000_add_sg_event_id_message_event/migration.sql
git commit -m "feat: add sgEventId unique column to message_events for idempotent webhook ingestion"
```

---

## Task 2: Types + event-type mapper

**Files:**
- Create: `src/features/events/types.ts`
- Create: `src/features/events/server/map-event-type.ts`
- Test: `src/features/events/server/map-event-type.test.ts`

- [ ] **Step 1: Write the failing tests for mapEventType**

Create `src/features/events/server/map-event-type.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapEventType } from './map-event-type'

describe('mapEventType', () => {
  it.each([
    ['delivered', 'DELIVERED'],
    ['open',      'OPENED'],
    ['click',     'CLICKED'],
    ['bounce',    'BOUNCED'],
    ['spamreport','SPAM_REPORT'],
    ['unsubscribe','UNSUBSCRIBED'],
    ['deferred',  'DEFERRED'],
    ['dropped',   'DROPPED'],
  ])('maps SendGrid "%s" to MessageEventType %s', (input, expected) => {
    expect(mapEventType(input)).toBe(expected)
  })

  it('returns null for unknown event types', () => {
    expect(mapEventType('processed')).toBeNull()
    expect(mapEventType('group_unsubscribe')).toBeNull()
    expect(mapEventType('')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/features/events/server/map-event-type.test.ts
```

Expected: FAIL — `mapEventType` not defined.

- [ ] **Step 3: Create types file**

Create `src/features/events/types.ts`:

```ts
// Raw shape of a single SendGrid event webhook payload.
// customArgs (draftId, leadId) are merged into the top level by SendGrid.
export interface SendGridRawEvent {
  event: string
  sg_event_id?: string
  sg_message_id?: string
  timestamp?: number
  email?: string
  // customArgs injected at send time
  draftId?: string
  leadId?: string
  [key: string]: unknown
}

export interface MessageEventDTO {
  id: string
  organizationId: string
  outboundMessageId: string
  sgEventId: string | null
  eventType: string
  providerEventType: string | null
  providerTimestamp: Date | null
  rawPayload: unknown
  createdAt: Date
}
```

- [ ] **Step 4: Create the mapper**

Create `src/features/events/server/map-event-type.ts`:

```ts
import type { MessageEventType } from '@prisma/client'

const EVENT_TYPE_MAP: Record<string, MessageEventType> = {
  delivered:   'DELIVERED',
  open:        'OPENED',
  click:       'CLICKED',
  bounce:      'BOUNCED',
  spamreport:  'SPAM_REPORT',
  unsubscribe: 'UNSUBSCRIBED',
  deferred:    'DEFERRED',
  dropped:     'DROPPED',
}

export function mapEventType(sendGridEvent: string): MessageEventType | null {
  return EVENT_TYPE_MAP[sendGridEvent] ?? null
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/features/events/server/map-event-type.test.ts
```

Expected: 11 tests PASS.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/events/types.ts src/features/events/server/map-event-type.ts src/features/events/server/map-event-type.test.ts
git commit -m "feat: add SendGrid event types and event-type mapper"
```

---

## Task 3: ingestWebhookEvents server function

**Files:**
- Create: `src/features/events/server/ingest-webhook-events.ts`
- Test: `src/features/events/server/ingest-webhook-events.test.ts`

**Context:**
- `OutboundMessage` is looked up by `draftId` (from `customArgs.draftId` on the event, top-level field)
- `organizationId` on `MessageEvent` is denormalized — sourced from the found `OutboundMessage.organizationId`
- Idempotency: upsert on `sgEventId` with `update: {}` (no-op for duplicates)
- Events with no `sg_event_id`, no `draftId`, unknown event type, or no matching `OutboundMessage` are skipped (logged, not thrown)
- Returns `{ processed: number, skipped: number }`

- [ ] **Step 1: Write the failing tests**

Create `src/features/events/server/ingest-webhook-events.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboundMessage: { findFirst: vi.fn() },
    messageEvent:    { upsert: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { ingestWebhookEvents } from './ingest-webhook-events'

const mockFindFirst = prisma.outboundMessage.findFirst as ReturnType<typeof vi.fn>
const mockUpsert    = prisma.messageEvent.upsert    as ReturnType<typeof vi.fn>

const baseMessage = {
  id: 'msg-1',
  organizationId: 'org-1',
}

beforeEach(() => vi.clearAllMocks())

describe('ingestWebhookEvents', () => {
  it('creates a MessageEvent for a valid delivered event', async () => {
    mockFindFirst.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    const result = await ingestWebhookEvents([
      {
        event: 'delivered',
        sg_event_id: 'evt-1',
        draftId: 'draft-1',
        timestamp: 1700000000,
      },
    ])

    expect(result).toEqual({ processed: 1, skipped: 0 })
    expect(mockFindFirst).toHaveBeenCalledWith({ where: { draftId: 'draft-1' }, select: { id: true, organizationId: true } })
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sgEventId: 'evt-1' },
        create: expect.objectContaining({
          sgEventId: 'evt-1',
          outboundMessageId: 'msg-1',
          organizationId: 'org-1',
          eventType: 'DELIVERED',
          providerEventType: 'delivered',
        }),
        update: {},
      }),
    )
  })

  it('skips events with no sg_event_id', async () => {
    const result = await ingestWebhookEvents([{ event: 'delivered', draftId: 'draft-1' }])
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('skips events with no draftId', async () => {
    const result = await ingestWebhookEvents([{ event: 'delivered', sg_event_id: 'evt-2' }])
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('skips events with unknown event type', async () => {
    const result = await ingestWebhookEvents([{ event: 'processed', sg_event_id: 'evt-3', draftId: 'draft-1' }])
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('skips events where OutboundMessage is not found', async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await ingestWebhookEvents([{ event: 'delivered', sg_event_id: 'evt-4', draftId: 'draft-missing' }])
    expect(result).toEqual({ processed: 0, skipped: 1 })
    expect(mockUpsert).not.toHaveBeenCalled()
  })

  it('processes multiple events and counts correctly', async () => {
    mockFindFirst.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    const result = await ingestWebhookEvents([
      { event: 'delivered', sg_event_id: 'evt-5', draftId: 'draft-1', timestamp: 1700000001 },
      { event: 'open',      sg_event_id: 'evt-6', draftId: 'draft-1', timestamp: 1700000002 },
      { event: 'processed', sg_event_id: 'evt-7', draftId: 'draft-1' }, // skipped
    ])

    expect(result).toEqual({ processed: 2, skipped: 1 })
  })

  it('stores the full raw payload in rawPayload', async () => {
    mockFindFirst.mockResolvedValue(baseMessage)
    mockUpsert.mockResolvedValue({})

    const rawEvent = { event: 'click', sg_event_id: 'evt-8', draftId: 'draft-1', url: 'https://example.com', timestamp: 1700000003 }
    await ingestWebhookEvents([rawEvent])

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ rawPayload: rawEvent }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/features/events/server/ingest-webhook-events.test.ts
```

Expected: FAIL — `ingestWebhookEvents` not defined.

- [ ] **Step 3: Implement ingestWebhookEvents**

Create `src/features/events/server/ingest-webhook-events.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type { SendGridRawEvent } from '../types'
import { mapEventType } from './map-event-type'

interface IngestResult {
  processed: number
  skipped: number
}

export async function ingestWebhookEvents(events: SendGridRawEvent[]): Promise<IngestResult> {
  let processed = 0
  let skipped = 0

  for (const event of events) {
    const skip = () => { skipped++; return false }

    if (!event.sg_event_id) { skip(); continue }
    if (!event.draftId)     { skip(); continue }

    const eventType = mapEventType(event.event)
    if (!eventType) { skip(); continue }

    const message = await prisma.outboundMessage.findFirst({
      where: { draftId: event.draftId },
      select: { id: true, organizationId: true },
    })

    if (!message) {
      console.warn(`[ingestWebhookEvents] OutboundMessage not found for draftId=${event.draftId}, sgEventId=${event.sg_event_id}`)
      skip()
      continue
    }

    const providerTimestamp = typeof event.timestamp === 'number'
      ? new Date(event.timestamp * 1000)
      : null

    await prisma.messageEvent.upsert({
      where: { sgEventId: event.sg_event_id },
      create: {
        organizationId:    message.organizationId,
        outboundMessageId: message.id,
        sgEventId:         event.sg_event_id,
        eventType,
        providerEventType: event.event,
        providerTimestamp,
        rawPayload:        event as object,
      },
      update: {},
    })

    processed++
  }

  return { processed, skipped }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/features/events/server/ingest-webhook-events.test.ts
```

Expected: 7 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/features/events/server/ingest-webhook-events.ts src/features/events/server/ingest-webhook-events.test.ts
git commit -m "feat: add ingestWebhookEvents — idempotent SendGrid event ingestion"
```

---

## Task 4: Webhook route

**Files:**
- Create: `src/app/api/webhooks/sendgrid/route.ts`

**Context:**
- No Clerk auth — this is a machine-to-machine endpoint
- Must always return 200 (even on application errors) so SendGrid does not retry
- Parse body as JSON array; if not an array, return 200 with a warning (never 4xx/5xx to SendGrid)
- Thin: parse → call `ingestWebhookEvents` → return 200

- [ ] **Step 1: Create the route**

Create `src/app/api/webhooks/sendgrid/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { ingestWebhookEvents } from '@/features/events/server/ingest-webhook-events'
import type { SendGridRawEvent } from '@/features/events/types'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    // Malformed JSON — log and ack so SendGrid doesn't retry forever
    console.warn('[POST /api/webhooks/sendgrid] Failed to parse JSON body')
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  if (!Array.isArray(body)) {
    console.warn('[POST /api/webhooks/sendgrid] Expected array, got:', typeof body)
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  try {
    const result = await ingestWebhookEvents(body as SendGridRawEvent[])
    return NextResponse.json({ ok: true, ...result }, { status: 200 })
  } catch (err) {
    // Log but still return 200 — application errors should not trigger SendGrid retries
    console.error('[POST /api/webhooks/sendgrid] Ingestion error:', err)
    return NextResponse.json({ ok: true }, { status: 200 })
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/webhooks/sendgrid/route.ts
git commit -m "feat: add POST /api/webhooks/sendgrid route for SendGrid event ingestion"
```
