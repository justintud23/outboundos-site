# Analytics Dashboard v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the analytics stub page with a real org-scoped analytics dashboard showing 8 KPI cards, derived rate percentages, and a recent replies section.

**Architecture:** Business logic lives in `src/features/analytics/server/get-analytics.ts`. The page is a thin server component that calls `getAnalytics` + `getReplies`, then passes results to a pure `KpiGrid` display component and the existing `RepliesTable`. No client components needed — no interactive state.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma v7, Clerk, Tailwind v4, Vitest + @testing-library/react (jsdom environment for component tests)

---

## Counting Semantics

| Metric | Source | Method |
|--------|--------|--------|
| `sent` | `OutboundMessage` | `count({ where: { organizationId } })` — every row = one email sent |
| `delivered` | `MessageEvent` | distinct `outboundMessageId` values where `eventType = 'DELIVERED'` |
| `opened` | `MessageEvent` | distinct `outboundMessageId` values where `eventType = 'OPENED'` |
| `clicked` | `MessageEvent` | distinct `outboundMessageId` values where `eventType = 'CLICKED'` |
| `bounced` | `MessageEvent` | distinct `outboundMessageId` values where `eventType = 'BOUNCED'` |
| `unsubscribes` | `MessageEvent` | distinct `outboundMessageId` values where `eventType = 'UNSUBSCRIBED'` |
| `replies` | `InboundReply` | `count({ where: { organizationId } })` |
| `positiveReplies` | `InboundReply` | `count({ where: { organizationId, classification: 'POSITIVE' } })` |

Distinct message counts use `prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: X } })` — Prisma returns one row per unique `outboundMessageId`, so `.length` gives the unique message count.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/features/analytics/types.ts` | Create | `AnalyticsDTO` interface |
| `src/features/analytics/server/get-analytics.ts` | Create | Org-scoped parallel query for all 8 metrics |
| `src/features/analytics/server/get-analytics.test.ts` | Create | Unit tests for `getAnalytics` |
| `src/features/analytics/components/kpi-grid.tsx` | Create | Pure KPI card grid with rates |
| `src/features/analytics/components/kpi-grid.test.tsx` | Create | Component render tests (jsdom) |
| `src/app/(dashboard)/analytics/page.tsx` | Modify | Replace stub — server component with data fetch |

---

## Task 1: `AnalyticsDTO` type

**Files:**
- Create: `src/features/analytics/types.ts`

- [ ] **Step 1: Create the type file**

Create `src/features/analytics/types.ts`:

```typescript
export interface AnalyticsDTO {
  sent: number
  delivered: number
  opened: number
  clicked: number
  replies: number
  positiveReplies: number
  bounced: number
  unsubscribes: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/analytics/types.ts
git commit -m "feat: add AnalyticsDTO type"
```

---

## Task 2: `getAnalytics` server function (TDD)

**Files:**
- Create: `src/features/analytics/server/get-analytics.ts`
- Create: `src/features/analytics/server/get-analytics.test.ts`

The function runs all 8 queries in parallel via `Promise.all`. The `messageEvent.groupBy` is called 5 times (once per event type) — in tests, mocks are called in this exact order: DELIVERED, OPENED, CLICKED, BOUNCED, UNSUBSCRIBED. `inboundReply.count` is called twice — first for total replies, then for POSITIVE replies.

- [ ] **Step 1: Write the failing test file**

Create `src/features/analytics/server/get-analytics.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboundMessage: { count: vi.fn() },
    messageEvent:    { groupBy: vi.fn() },
    inboundReply:    { count: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getAnalytics } from './get-analytics'

const mockSentCount      = prisma.outboundMessage.count as ReturnType<typeof vi.fn>
const mockEventGroupBy   = prisma.messageEvent.groupBy  as ReturnType<typeof vi.fn>
const mockReplyCount     = prisma.inboundReply.count    as ReturnType<typeof vi.fn>

// Helper: set up all mocks for one test scenario.
// groupBy order: DELIVERED → OPENED → CLICKED → BOUNCED → UNSUBSCRIBED
// replyCount order: total replies → positive replies
function setupMocks({
  sent = 0,
  delivered = [] as object[],
  opened = [] as object[],
  clicked = [] as object[],
  bounced = [] as object[],
  unsubscribed = [] as object[],
  replies = 0,
  positiveReplies = 0,
} = {}) {
  mockSentCount.mockResolvedValue(sent)
  mockEventGroupBy
    .mockResolvedValueOnce(delivered)
    .mockResolvedValueOnce(opened)
    .mockResolvedValueOnce(clicked)
    .mockResolvedValueOnce(bounced)
    .mockResolvedValueOnce(unsubscribed)
  mockReplyCount
    .mockResolvedValueOnce(replies)
    .mockResolvedValueOnce(positiveReplies)
}

beforeEach(() => vi.clearAllMocks())

describe('getAnalytics', () => {
  it('returns all-zero metrics when org has no data', async () => {
    setupMocks()

    const result = await getAnalytics({ organizationId: 'org-1' })

    expect(result).toEqual({
      sent: 0,
      delivered: 0,
      opened: 0,
      clicked: 0,
      bounced: 0,
      unsubscribes: 0,
      replies: 0,
      positiveReplies: 0,
    })
  })

  it('counts unique messages per event type (length of groupBy result)', async () => {
    setupMocks({
      sent: 10,
      delivered:   [{ outboundMessageId: 'm1' }, { outboundMessageId: 'm2' }, { outboundMessageId: 'm3' }],
      opened:      [{ outboundMessageId: 'm1' }, { outboundMessageId: 'm2' }],
      clicked:     [{ outboundMessageId: 'm1' }],
      bounced:     [],
      unsubscribed:[{ outboundMessageId: 'm4' }],
      replies: 4,
      positiveReplies: 2,
    })

    const result = await getAnalytics({ organizationId: 'org-1' })

    expect(result).toEqual({
      sent: 10,
      delivered: 3,
      opened: 2,
      clicked: 1,
      bounced: 0,
      unsubscribes: 1,
      replies: 4,
      positiveReplies: 2,
    })
  })

  it('scopes all queries to the provided organizationId', async () => {
    setupMocks({ sent: 5 })

    await getAnalytics({ organizationId: 'org-abc' })

    expect(mockSentCount).toHaveBeenCalledWith({ where: { organizationId: 'org-abc' } })
    expect(mockEventGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-abc' }) }),
    )
    expect(mockReplyCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-abc' }) }),
    )
  })

  it('queries each distinct event type', async () => {
    setupMocks()

    await getAnalytics({ organizationId: 'org-1' })

    const calls = mockEventGroupBy.mock.calls.map((c: [{ where: { eventType: string } }]) => c[0].where.eventType)
    expect(calls).toEqual(['DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'UNSUBSCRIBED'])
  })

  it('counts positive replies separately from total replies', async () => {
    setupMocks({ replies: 10, positiveReplies: 3 })

    const result = await getAnalytics({ organizationId: 'org-1' })

    expect(result.replies).toBe(10)
    expect(result.positiveReplies).toBe(3)
    const replyCountCalls = mockReplyCount.mock.calls
    // Second call should filter by classification: 'POSITIVE'
    expect(replyCountCalls[1][0]).toMatchObject({
      where: { classification: 'POSITIVE' },
    })
  })

  it('does not mix data from different organizations', async () => {
    // org-A has data, org-B should not inherit it
    setupMocks({ sent: 5, delivered: [{ outboundMessageId: 'm1' }] })

    await getAnalytics({ organizationId: 'org-A' })

    // All queries scoped to org-A only
    expect(mockSentCount).toHaveBeenCalledTimes(1)
    expect(mockSentCount).toHaveBeenCalledWith({ where: { organizationId: 'org-A' } })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/features/analytics/server/get-analytics.test.ts
```

Expected: FAIL — `Cannot find module './get-analytics'`

- [ ] **Step 3: Implement `get-analytics.ts`**

Create `src/features/analytics/server/get-analytics.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { AnalyticsDTO } from '../types'

interface GetAnalyticsInput {
  organizationId: string
}

export async function getAnalytics({ organizationId }: GetAnalyticsInput): Promise<AnalyticsDTO> {
  const [
    sent,
    deliveredRows,
    openedRows,
    clickedRows,
    bouncedRows,
    unsubscribedRows,
    replies,
    positiveReplies,
  ] = await Promise.all([
    prisma.outboundMessage.count({ where: { organizationId } }),
    prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: 'DELIVERED' } }),
    prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: 'OPENED' } }),
    prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: 'CLICKED' } }),
    prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: 'BOUNCED' } }),
    prisma.messageEvent.groupBy({ by: ['outboundMessageId'], where: { organizationId, eventType: 'UNSUBSCRIBED' } }),
    prisma.inboundReply.count({ where: { organizationId } }),
    prisma.inboundReply.count({ where: { organizationId, classification: 'POSITIVE' } }),
  ])

  return {
    sent,
    delivered: deliveredRows.length,
    opened: openedRows.length,
    clicked: clickedRows.length,
    bounced: bouncedRows.length,
    unsubscribes: unsubscribedRows.length,
    replies,
    positiveReplies,
  }
}
```

- [ ] **Step 4: Run to confirm all tests pass**

```bash
npx vitest run src/features/analytics/server/get-analytics.test.ts
```

Expected: 6 tests PASS

- [ ] **Step 5: Run full suite to confirm no regressions**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/features/analytics/server/get-analytics.ts src/features/analytics/server/get-analytics.test.ts
git commit -m "feat: add getAnalytics server function"
```

---

## Task 3: `KpiGrid` component

**Files:**
- Create: `src/features/analytics/components/kpi-grid.tsx`

This is a pure display component. `KpiCard` is a private subcomponent co-located in the same file.

- [ ] **Step 1: Create the component**

Create `src/features/analytics/components/kpi-grid.tsx`:

```typescript
import type { AnalyticsDTO } from '../types'

interface KpiGridProps {
  analytics: AnalyticsDTO
}

interface KpiCardProps {
  label: string
  value: number
  rate?: string
  accent?: 'success' | 'danger'
}

function pct(numerator: number, denominator: number): string | undefined {
  if (denominator === 0) return undefined
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

function KpiCard({ label, value, rate, accent }: KpiCardProps) {
  const valueColor =
    accent === 'success'
      ? 'text-[#10b981]'
      : accent === 'danger'
        ? 'text-[#ef4444]'
        : 'text-[#e2e8f0]'

  return (
    <div className="bg-[#13151c] border border-[#1e2130] rounded-lg p-5">
      <p className="text-[#475569] text-xs uppercase tracking-wide font-medium mb-2">{label}</p>
      <p className={`text-3xl font-semibold tabular-nums ${valueColor}`}>{value.toLocaleString()}</p>
      {rate !== undefined && (
        <p className="text-[#475569] text-xs mt-1">{rate} rate</p>
      )}
    </div>
  )
}

export function KpiGrid({ analytics }: KpiGridProps) {
  const { sent, delivered, opened, clicked, replies, positiveReplies, bounced, unsubscribes } = analytics

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard label="Sent"             value={sent} />
      <KpiCard label="Delivered"        value={delivered}      rate={pct(delivered, sent)} />
      <KpiCard label="Opened"           value={opened}         rate={pct(opened, sent)}         accent="success" />
      <KpiCard label="Clicked"          value={clicked}        rate={pct(clicked, sent)}         accent="success" />
      <KpiCard label="Replies"          value={replies} />
      <KpiCard label="Positive Replies" value={positiveReplies} rate={pct(positiveReplies, replies)} accent="success" />
      <KpiCard label="Bounced"          value={bounced}        rate={pct(bounced, sent)}         accent="danger" />
      <KpiCard label="Unsubscribes"     value={unsubscribes}   rate={pct(unsubscribes, sent)}    accent="danger" />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/analytics/components/kpi-grid.tsx
git commit -m "feat: add KpiGrid component"
```

---

## Task 4: `KpiGrid` component tests

**Files:**
- Create: `src/features/analytics/components/kpi-grid.test.tsx`

Uses `@vitest-environment jsdom` pragma so these run against a DOM. The rest of the suite is unaffected (node environment).

- [ ] **Step 1: Create the test file**

Create `src/features/analytics/components/kpi-grid.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { KpiGrid } from './kpi-grid'
import type { AnalyticsDTO } from '../types'

const baseAnalytics: AnalyticsDTO = {
  sent: 100,
  delivered: 90,
  opened: 45,
  clicked: 10,
  replies: 8,
  positiveReplies: 5,
  bounced: 3,
  unsubscribes: 2,
}

const zeroAnalytics: AnalyticsDTO = {
  sent: 0,
  delivered: 0,
  opened: 0,
  clicked: 0,
  replies: 0,
  positiveReplies: 0,
  bounced: 0,
  unsubscribes: 0,
}

describe('KpiGrid', () => {
  it('renders all 8 KPI labels', () => {
    render(<KpiGrid analytics={baseAnalytics} />)

    expect(screen.getByText('Sent')).toBeDefined()
    expect(screen.getByText('Delivered')).toBeDefined()
    expect(screen.getByText('Opened')).toBeDefined()
    expect(screen.getByText('Clicked')).toBeDefined()
    expect(screen.getByText('Replies')).toBeDefined()
    expect(screen.getByText('Positive Replies')).toBeDefined()
    expect(screen.getByText('Bounced')).toBeDefined()
    expect(screen.getByText('Unsubscribes')).toBeDefined()
  })

  it('renders metric values', () => {
    render(<KpiGrid analytics={baseAnalytics} />)

    expect(screen.getByText('100')).toBeDefined()
    expect(screen.getByText('90')).toBeDefined()
    expect(screen.getByText('45')).toBeDefined()
  })

  it('shows no rate text when sent is zero (avoids division by zero)', () => {
    render(<KpiGrid analytics={zeroAnalytics} />)

    const rateTexts = screen.queryAllByText(/rate/)
    expect(rateTexts).toHaveLength(0)
  })

  it('shows correct open rate percentage', () => {
    render(<KpiGrid analytics={baseAnalytics} />)
    // opened=45, sent=100 → 45.0% rate
    expect(screen.getByText('45.0% rate')).toBeDefined()
  })

  it('shows correct positive reply rate percentage', () => {
    render(<KpiGrid analytics={baseAnalytics} />)
    // positiveReplies=5, replies=8 → 62.5% rate
    expect(screen.getByText('62.5% rate')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run the component tests**

```bash
npx vitest run src/features/analytics/components/kpi-grid.test.tsx
```

Expected: All 5 tests PASS

- [ ] **Step 3: Run full suite**

```bash
npx vitest run
```

Expected: All tests PASS (was 90, now 96)

- [ ] **Step 4: Commit**

```bash
git add src/features/analytics/components/kpi-grid.test.tsx
git commit -m "test: add KpiGrid component tests"
```

---

## Task 5: Analytics page (replace stub)

**Files:**
- Modify: `src/app/(dashboard)/analytics/page.tsx`

The page is a pure server component. It calls `getAnalytics` + `getReplies` in parallel, renders the `KpiGrid`, a recent replies section (reusing `RepliesTable`), and a small metric notes footer.

- [ ] **Step 1: Replace the stub**

Replace the entire contents of `src/app/(dashboard)/analytics/page.tsx` with:

```typescript
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { KpiGrid } from '@/features/analytics/components/kpi-grid'
import { getAnalytics } from '@/features/analytics/server/get-analytics'
import { RepliesTable } from '@/features/replies/components/replies-table'
import { getReplies } from '@/features/replies/server/get-replies'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function AnalyticsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)

  const [analytics, { replies: recentReplies }] = await Promise.all([
    getAnalytics({ organizationId: org.id }),
    getReplies({ organizationId: org.id, limit: 5 }),
  ])

  return (
    <>
      <Header title="Analytics" />
      <div className="flex-1 p-6 space-y-8">

        <KpiGrid analytics={analytics} />

        <div>
          <h2 className="text-[#475569] text-xs uppercase tracking-wide font-medium mb-3">
            Recent Replies
          </h2>
          <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
            <RepliesTable replies={recentReplies} />
          </div>
        </div>

        <p className="text-[#334155] text-xs leading-relaxed">
          Delivered, opened, clicked, bounced, and unsubscribe counts reflect unique emails (one message counted once per event type regardless of how many events were received). Positive replies are classified by AI.
        </p>

      </div>
    </>
  )
}
```

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/analytics/page.tsx
git commit -m "feat: implement analytics dashboard v1"
```

---

## Acceptance Criteria

- [ ] `/analytics` renders for an authenticated org member
- [ ] All 8 KPI cards visible: Sent, Delivered, Opened, Clicked, Replies, Positive Replies, Bounced, Unsubscribes
- [ ] Rate percentages shown for Delivered, Opened, Clicked, Positive Replies, Bounced, Unsubscribes
- [ ] Rates are hidden (not shown as `NaN%`) when denominator is zero
- [ ] POSITIVE rows in recent replies are green-tinted (inherited from `RepliesTable`)
- [ ] Metric notes footer visible
- [ ] All queries are org-scoped to the authenticated user's organization
- [ ] All existing tests pass (`npx vitest run`)
- [ ] 6 new server tests + 5 new component tests = 101 total passing
