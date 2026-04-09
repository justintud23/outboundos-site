# Dashboard & Analytics Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Dashboard page (Modular Workspace with 6 chart modules) and Analytics page (Executive Command Center with KPI strip, funnel, multi-line chart, and sortable campaign table), powered by new time-series query functions, Recharts, and a snapshot/refresh system.

**Architecture:** 5 new read-only server functions provide time-series, funnel, classification, and campaign performance data. Two page-level refresh API routes enable client-side refresh without full page reload. Recharts (dynamically imported) renders charts. A shared SnapshotBar component controls date range, live mode, and refresh across both pages. All queries are org-scoped and use existing indexes.

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL, Recharts, TypeScript strict, Tailwind v4, clsx, lucide-react.

**Spec:** `docs/superpowers/specs/2026-04-09-dashboard-analytics-redesign.md`

---

## File Structure

**Create (22 files):**

Server functions (5):
- `src/features/analytics/server/get-daily-activity.ts`
- `src/features/analytics/server/get-daily-activity-extended.ts`
- `src/features/analytics/server/get-campaign-performance.ts`
- `src/features/analytics/server/get-classification-breakdown.ts`
- `src/features/analytics/server/get-funnel-data.ts`

API routes (2):
- `src/app/api/dashboard/refresh/route.ts`
- `src/app/api/analytics/refresh/route.ts`

Shared components (3):
- `src/components/charts/recharts-wrapper.tsx`
- `src/components/charts/funnel-chart.tsx`
- `src/components/ui/skeleton.tsx`

Dashboard components (6):
- `src/app/(dashboard)/dashboard/dashboard-client.tsx`
- `src/features/dashboard/components/dashboard-module.tsx`
- `src/features/dashboard/components/kpi-summary.tsx`
- `src/features/dashboard/components/classification-chart.tsx`
- `src/features/dashboard/components/activity-chart.tsx`
- `src/features/dashboard/components/campaign-chart.tsx`
- `src/features/dashboard/components/snapshot-bar.tsx`
- `src/features/dashboard/components/recent-replies-compact.tsx`

Analytics components (4):
- `src/app/(dashboard)/analytics/analytics-client.tsx`
- `src/features/analytics/components/kpi-strip.tsx`
- `src/features/analytics/components/activity-line-chart.tsx`
- `src/features/analytics/components/campaign-table.tsx`

**Modify (3 files):**
- `src/app/(dashboard)/dashboard/page.tsx`
- `src/app/(dashboard)/analytics/page.tsx`
- `src/features/analytics/types.ts`

---

### Task 1: Install Recharts + Update Analytics Types

**Files:**
- Modify: `package.json` (via npm install)
- Modify: `src/features/analytics/types.ts`

- [ ] **Step 1: Install recharts**

Run:
```bash
cd "/Users/justintud/Desktop/Coding Projects/outboundos-site"
npm install recharts
```

- [ ] **Step 2: Add new DTOs to analytics types**

Append to `src/features/analytics/types.ts`:

```typescript
import type { CampaignStatus, ReplyClassification } from '@prisma/client'

// ─── Time-series ─────────────────────────────────────────────

export interface DailyActivityPoint {
  date: string
  sent: number
  replied: number
}

export interface DailyActivityExtendedPoint {
  date: string
  sent: number
  delivered: number
  opened: number
  replied: number
}

// ─── Funnel ──────────────────────────────────────────────────

export interface FunnelStageDTO {
  stage: string
  count: number
  rate: number
}

// ─── Campaign Performance ────────────────────────────────────

export interface CampaignPerformanceDTO {
  id: string
  name: string
  status: CampaignStatus
  sent: number
  delivered: number
  opened: number
  replied: number
  positiveReplies: number
  openRate: number
  replyRate: number
}

// ─── Classification ──────────────────────────────────────────

export interface ClassificationBreakdownDTO {
  classification: ReplyClassification
  count: number
}

// ─── Dashboard aggregate ─────────────────────────────────────

export interface DashboardRefreshData {
  summary: import('@/features/dashboard/server/get-dashboard-summary').DashboardSummaryDTO
  funnel: FunnelStageDTO[]
  activity: DailyActivityPoint[]
  classification: ClassificationBreakdownDTO[]
  campaigns: CampaignPerformanceDTO[]
  recentReplies: import('@/features/replies/types').ReplyWithLeadDTO[]
}

export interface AnalyticsRefreshData {
  analytics: AnalyticsDTO
  funnel: FunnelStageDTO[]
  activity: DailyActivityExtendedPoint[]
  campaigns: CampaignPerformanceDTO[]
  classification: ClassificationBreakdownDTO[]
}
```

Note: The existing `AnalyticsDTO` interface stays unchanged at the top of the file. Add the `import type` for `CampaignStatus` and `ReplyClassification` at the top of the file alongside the existing content.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/features/analytics/types.ts
git commit -m "feat: install recharts and add chart DTOs to analytics types"
```

---

### Task 2: Server Functions — getDailyActivity + getDailyActivityExtended

**Files:**
- Create: `src/features/analytics/server/get-daily-activity.ts`
- Create: `src/features/analytics/server/get-daily-activity-extended.ts`

- [ ] **Step 1: Create get-daily-activity.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { DailyActivityPoint } from '../types'

interface GetDailyActivityInput {
  organizationId: string
  days?: number
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function generateDateRange(days: number): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    dates.push(formatDate(d))
  }
  return dates
}

export async function getDailyActivity({
  organizationId,
  days = 30,
}: GetDailyActivityInput): Promise<DailyActivityPoint[]> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  since.setUTCHours(0, 0, 0, 0)

  const [sentRows, repliedRows] = await Promise.all([
    prisma.outboundMessage.groupBy({
      by: ['sentAt'],
      where: {
        organizationId,
        sentAt: { gte: since },
      },
      _count: { _all: true },
    }),
    prisma.inboundReply.groupBy({
      by: ['receivedAt'],
      where: {
        organizationId,
        receivedAt: { gte: since },
      },
      _count: { _all: true },
    }),
  ])

  // Bucket by date
  const sentMap = new Map<string, number>()
  for (const row of sentRows) {
    if (row.sentAt) {
      const key = formatDate(row.sentAt)
      sentMap.set(key, (sentMap.get(key) ?? 0) + row._count._all)
    }
  }

  const repliedMap = new Map<string, number>()
  for (const row of repliedRows) {
    const key = formatDate(row.receivedAt)
    repliedMap.set(key, (repliedMap.get(key) ?? 0) + row._count._all)
  }

  // Zero-fill
  const dateRange = generateDateRange(days)
  return dateRange.map((date) => ({
    date,
    sent: sentMap.get(date) ?? 0,
    replied: repliedMap.get(date) ?? 0,
  }))
}
```

- [ ] **Step 2: Create get-daily-activity-extended.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { DailyActivityExtendedPoint } from '../types'

interface GetDailyActivityExtendedInput {
  organizationId: string
  days?: number
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function generateDateRange(days: number): string[] {
  const dates: string[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now)
    d.setUTCDate(d.getUTCDate() - i)
    dates.push(formatDate(d))
  }
  return dates
}

export async function getDailyActivityExtended({
  organizationId,
  days = 30,
}: GetDailyActivityExtendedInput): Promise<DailyActivityExtendedPoint[]> {
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  since.setUTCHours(0, 0, 0, 0)

  const [sentRows, deliveredRows, openedRows, repliedRows] = await Promise.all([
    prisma.outboundMessage.groupBy({
      by: ['sentAt'],
      where: { organizationId, sentAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.messageEvent.groupBy({
      by: ['providerTimestamp'],
      where: { organizationId, eventType: 'DELIVERED', providerTimestamp: { gte: since } },
      _count: { _all: true },
    }),
    prisma.messageEvent.groupBy({
      by: ['providerTimestamp'],
      where: { organizationId, eventType: 'OPENED', providerTimestamp: { gte: since } },
      _count: { _all: true },
    }),
    prisma.inboundReply.groupBy({
      by: ['receivedAt'],
      where: { organizationId, receivedAt: { gte: since } },
      _count: { _all: true },
    }),
  ])

  function bucketByDate(rows: { _count: { _all: number }; [key: string]: unknown }[], dateField: string): Map<string, number> {
    const map = new Map<string, number>()
    for (const row of rows) {
      const val = row[dateField] as Date | null
      if (val) {
        const key = formatDate(val)
        map.set(key, (map.get(key) ?? 0) + row._count._all)
      }
    }
    return map
  }

  const sentMap = bucketByDate(sentRows, 'sentAt')
  const deliveredMap = bucketByDate(deliveredRows, 'providerTimestamp')
  const openedMap = bucketByDate(openedRows, 'providerTimestamp')
  const repliedMap = bucketByDate(repliedRows, 'receivedAt')

  const dateRange = generateDateRange(days)
  return dateRange.map((date) => ({
    date,
    sent: sentMap.get(date) ?? 0,
    delivered: deliveredMap.get(date) ?? 0,
    opened: openedMap.get(date) ?? 0,
    replied: repliedMap.get(date) ?? 0,
  }))
}
```

- [ ] **Step 3: Commit**

```bash
git add src/features/analytics/server/get-daily-activity.ts src/features/analytics/server/get-daily-activity-extended.ts
git commit -m "feat: add getDailyActivity and getDailyActivityExtended server functions"
```

---

### Task 3: Server Functions — getFunnelData + getClassificationBreakdown + getCampaignPerformance

**Files:**
- Create: `src/features/analytics/server/get-funnel-data.ts`
- Create: `src/features/analytics/server/get-classification-breakdown.ts`
- Create: `src/features/analytics/server/get-campaign-performance.ts`

- [ ] **Step 1: Create get-funnel-data.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { FunnelStageDTO } from '../types'

interface GetFunnelDataInput {
  organizationId: string
  days?: number
}

export async function getFunnelData({
  organizationId,
  days,
}: GetFunnelDataInput): Promise<FunnelStageDTO[]> {
  const since = days ? (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - days)
    d.setUTCHours(0, 0, 0, 0)
    return d
  })() : undefined

  const dateFilter = since ? { gte: since } : undefined

  const [sent, deliveredRows, openedRows, replied, interested] = await Promise.all([
    prisma.outboundMessage.count({
      where: { organizationId, ...(dateFilter && { sentAt: dateFilter }) },
    }),
    prisma.messageEvent.groupBy({
      by: ['outboundMessageId'],
      where: { organizationId, eventType: 'DELIVERED', ...(dateFilter && { providerTimestamp: dateFilter }) },
    }),
    prisma.messageEvent.groupBy({
      by: ['outboundMessageId'],
      where: { organizationId, eventType: 'OPENED', ...(dateFilter && { providerTimestamp: dateFilter }) },
    }),
    prisma.inboundReply.count({
      where: { organizationId, ...(dateFilter && { receivedAt: dateFilter }) },
    }),
    prisma.lead.count({
      where: { organizationId, status: 'INTERESTED' },
    }),
  ])

  const delivered = deliveredRows.length
  const opened = openedRows.length
  const rate = (n: number) => sent === 0 ? 0 : Math.round((n / sent) * 1000) / 1000

  return [
    { stage: 'Sent', count: sent, rate: 1 },
    { stage: 'Delivered', count: delivered, rate: rate(delivered) },
    { stage: 'Opened', count: opened, rate: rate(opened) },
    { stage: 'Replied', count: replied, rate: rate(replied) },
    { stage: 'Interested', count: interested, rate: rate(interested) },
  ]
}
```

- [ ] **Step 2: Create get-classification-breakdown.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { ClassificationBreakdownDTO } from '../types'

interface GetClassificationBreakdownInput {
  organizationId: string
  days?: number
}

export async function getClassificationBreakdown({
  organizationId,
  days,
}: GetClassificationBreakdownInput): Promise<ClassificationBreakdownDTO[]> {
  const since = days ? (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - days)
    d.setUTCHours(0, 0, 0, 0)
    return d
  })() : undefined

  const rows = await prisma.inboundReply.groupBy({
    by: ['classification'],
    where: {
      organizationId,
      ...(since && { receivedAt: { gte: since } }),
    },
    _count: { _all: true },
  })

  return rows
    .map((r) => ({ classification: r.classification, count: r._count._all }))
    .sort((a, b) => b.count - a.count)
}
```

- [ ] **Step 3: Create get-campaign-performance.ts**

```typescript
import { prisma } from '@/lib/db/prisma'
import type { CampaignPerformanceDTO } from '../types'

interface GetCampaignPerformanceInput {
  organizationId: string
  days?: number
}

export async function getCampaignPerformance({
  organizationId,
  days,
}: GetCampaignPerformanceInput): Promise<CampaignPerformanceDTO[]> {
  const since = days ? (() => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - days)
    d.setUTCHours(0, 0, 0, 0)
    return d
  })() : undefined

  const dateFilter = since ? { gte: since } : undefined

  // Get campaigns with message counts
  const campaigns = await prisma.campaign.findMany({
    where: { organizationId },
    select: {
      id: true,
      name: true,
      status: true,
      _count: { select: { outboundMessages: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  if (campaigns.length === 0) return []

  const campaignIds = campaigns.map((c) => c.id)

  // Parallel aggregation queries — no N+1
  const [deliveredRows, openedRows, replyCounts, positiveCounts] = await Promise.all([
    prisma.messageEvent.groupBy({
      by: ['outboundMessageId'],
      where: {
        organizationId,
        eventType: 'DELIVERED',
        outboundMessage: { campaignId: { in: campaignIds } },
        ...(dateFilter && { providerTimestamp: dateFilter }),
      },
      _count: { _all: true },
    }).then(async (rows) => {
      // Map back to campaignId
      if (rows.length === 0) return new Map<string, number>()
      const msgIds = rows.map((r) => r.outboundMessageId)
      const msgs = await prisma.outboundMessage.findMany({
        where: { id: { in: msgIds } },
        select: { id: true, campaignId: true },
      })
      const msgToCampaign = new Map(msgs.map((m) => [m.id, m.campaignId]))
      const result = new Map<string, number>()
      for (const row of rows) {
        const cid = msgToCampaign.get(row.outboundMessageId)
        if (cid) result.set(cid, (result.get(cid) ?? 0) + 1)
      }
      return result
    }),
    prisma.messageEvent.groupBy({
      by: ['outboundMessageId'],
      where: {
        organizationId,
        eventType: 'OPENED',
        outboundMessage: { campaignId: { in: campaignIds } },
        ...(dateFilter && { providerTimestamp: dateFilter }),
      },
      _count: { _all: true },
    }).then(async (rows) => {
      if (rows.length === 0) return new Map<string, number>()
      const msgIds = rows.map((r) => r.outboundMessageId)
      const msgs = await prisma.outboundMessage.findMany({
        where: { id: { in: msgIds } },
        select: { id: true, campaignId: true },
      })
      const msgToCampaign = new Map(msgs.map((m) => [m.id, m.campaignId]))
      const result = new Map<string, number>()
      for (const row of rows) {
        const cid = msgToCampaign.get(row.outboundMessageId)
        if (cid) result.set(cid, (result.get(cid) ?? 0) + 1)
      }
      return result
    }),
    Promise.all(campaignIds.map((campaignId) =>
      prisma.inboundReply.count({
        where: { organizationId, outboundMessage: { campaignId } },
      }).then((count) => ({ campaignId, count })),
    )),
    Promise.all(campaignIds.map((campaignId) =>
      prisma.inboundReply.count({
        where: { organizationId, outboundMessage: { campaignId }, classification: 'POSITIVE' },
      }).then((count) => ({ campaignId, count })),
    )),
  ])

  const replyMap = new Map(replyCounts.map((r) => [r.campaignId, r.count]))
  const positiveMap = new Map(positiveCounts.map((r) => [r.campaignId, r.count]))

  return campaigns
    .map((c) => {
      const sent = c._count.outboundMessages
      const delivered = deliveredRows.get(c.id) ?? 0
      const opened = openedRows.get(c.id) ?? 0
      const replied = replyMap.get(c.id) ?? 0
      const positive = positiveMap.get(c.id) ?? 0
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        sent,
        delivered,
        opened,
        replied,
        positiveReplies: positive,
        openRate: sent === 0 ? 0 : Math.round((opened / sent) * 1000) / 1000,
        replyRate: sent === 0 ? 0 : Math.round((replied / sent) * 1000) / 1000,
      }
    })
    .sort((a, b) => b.sent - a.sent)
}
```

- [ ] **Step 4: Commit**

```bash
git add src/features/analytics/server/get-funnel-data.ts src/features/analytics/server/get-classification-breakdown.ts src/features/analytics/server/get-campaign-performance.ts
git commit -m "feat: add funnel, classification, and campaign performance query functions"
```

---

### Task 4: Shared Components — Skeleton, Recharts Wrapper, Funnel Chart

**Files:**
- Create: `src/components/ui/skeleton.tsx`
- Create: `src/components/charts/recharts-wrapper.tsx`
- Create: `src/components/charts/funnel-chart.tsx`

- [ ] **Step 1: Create skeleton.tsx**

Create `src/components/ui/skeleton.tsx`:

```tsx
export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="bg-[var(--bg-surface-raised)] rounded-[var(--radius-btn)] animate-pulse"
      style={{ height }}
    />
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-[var(--bg-surface-raised)] rounded-[var(--radius-btn)] animate-pulse" />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create recharts-wrapper.tsx**

Create `src/components/charts/recharts-wrapper.tsx`:

```tsx
'use client'

import dynamic from 'next/dynamic'
import { ChartSkeleton } from '@/components/ui/skeleton'

const loading = () => <ChartSkeleton height={250} />

export const LazyAreaChart = dynamic(
  () => import('recharts').then((mod) => mod.AreaChart),
  { ssr: false, loading },
)

export const LazyBarChart = dynamic(
  () => import('recharts').then((mod) => mod.BarChart),
  { ssr: false, loading },
)

export const LazyLineChart = dynamic(
  () => import('recharts').then((mod) => mod.LineChart),
  { ssr: false, loading },
)

export const LazyResponsiveContainer = dynamic(
  () => import('recharts').then((mod) => mod.ResponsiveContainer),
  { ssr: false, loading },
)

// Re-export non-lazy components that don't need dynamic import
export {
  XAxis, YAxis, CartesianGrid, Tooltip, Area, Bar, Line, Legend, Cell,
} from 'recharts'
```

- [ ] **Step 3: Create funnel-chart.tsx**

Create `src/components/charts/funnel-chart.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import type { FunnelStageDTO } from '@/features/analytics/types'

const STAGE_COLORS = [
  'var(--accent-indigo)',
  'color-mix(in srgb, var(--accent-indigo) 80%, var(--accent-cyan) 20%)',
  'color-mix(in srgb, var(--accent-indigo) 50%, var(--accent-cyan) 50%)',
  'color-mix(in srgb, var(--accent-cyan) 80%, var(--accent-indigo) 20%)',
  'var(--accent-cyan)',
]

interface FunnelChartProps {
  stages: FunnelStageDTO[]
  size?: 'compact' | 'full'
}

export function FunnelChart({ stages, size = 'compact' }: FunnelChartProps) {
  const [animated, setAnimated] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 100)
    return () => clearTimeout(timer)
  }, [])

  if (stages.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-[var(--text-muted)] text-sm">Send your first outreach to see your pipeline funnel</p>
      </div>
    )
  }

  const maxCount = stages[0]?.count ?? 1
  const barHeight = size === 'full' ? 'h-10' : 'h-7'
  const textSize = size === 'full' ? 'text-sm' : 'text-xs'
  const gap = size === 'full' ? 'gap-3' : 'gap-2'

  return (
    <div className={`flex flex-col ${gap}`}>
      {stages.map((stage, i) => {
        const widthPercent = maxCount === 0 ? 0 : (stage.count / maxCount) * 100
        const [hovered, setHovered] = useState(false)

        return (
          <div key={stage.stage} className="flex items-center gap-3">
            <span className={`${textSize} text-[var(--text-secondary)] w-20 text-right flex-shrink-0`}>
              {stage.stage}
            </span>
            <div className="flex-1 relative">
              <div
                className={`${barHeight} rounded-[var(--radius-btn)] transition-all duration-700 ease-out`}
                style={{
                  width: animated ? `${Math.max(widthPercent, 2)}%` : '0%',
                  backgroundColor: STAGE_COLORS[i] ?? 'var(--accent-indigo)',
                  opacity: hovered ? 1 : 0.8,
                  boxShadow: hovered ? `0 0 12px ${STAGE_COLORS[i]}40` : 'none',
                }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
              />
            </div>
            <span className={`${textSize} text-[var(--text-muted)] w-24 flex-shrink-0 tabular-nums`}>
              {stage.count.toLocaleString()} · {(stage.rate * 100).toFixed(0)}%
            </span>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/skeleton.tsx src/components/charts/recharts-wrapper.tsx src/components/charts/funnel-chart.tsx
git commit -m "feat: add skeleton, recharts wrapper, and funnel chart components"
```

---

### Task 5: SnapshotBar Component

**Files:**
- Create: `src/features/dashboard/components/snapshot-bar.tsx`

- [ ] **Step 1: Create snapshot-bar.tsx**

```tsx
'use client'

import { RefreshCw } from 'lucide-react'

interface SnapshotBarProps {
  lastUpdatedAt: Date
  dateRange: '7d' | '30d'
  isLive: boolean
  onRefresh: () => void
  onDateRangeChange: (range: '7d' | '30d') => void
  onLiveToggle: () => void
  refreshing: boolean
}

export function SnapshotBar({
  lastUpdatedAt,
  dateRange,
  isLive,
  onRefresh,
  onDateRangeChange,
  onLiveToggle,
  refreshing,
}: SnapshotBarProps) {
  const timeStr = lastUpdatedAt.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      {/* Date range pills */}
      <div className="flex gap-1">
        {(['7d', '30d'] as const).map((range) => (
          <button
            key={range}
            onClick={() => onDateRangeChange(range)}
            className={[
              'px-3 py-1.5 rounded-[var(--radius-btn)] text-xs font-medium transition-colors duration-[var(--transition-base)]',
              dateRange === range
                ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
            ].join(' ')}
          >
            {range === '7d' ? '7 days' : '30 days'}
          </button>
        ))}
      </div>

      {/* Timestamp */}
      <span className="text-[var(--text-muted)] text-xs">
        Last updated at {timeStr}
      </span>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* Live toggle */}
        <button
          onClick={onLiveToggle}
          className={[
            'flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-btn)] text-xs font-medium transition-colors',
            isLive
              ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
          ].join(' ')}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-[var(--status-success)] animate-pulse' : 'bg-[var(--text-muted)]'}`} />
          Live
        </button>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/dashboard/components/snapshot-bar.tsx
git commit -m "feat: add SnapshotBar with date range, live toggle, and refresh"
```

---

### Task 6: Dashboard Module + Chart Components

**Files:**
- Create: `src/features/dashboard/components/dashboard-module.tsx`
- Create: `src/features/dashboard/components/kpi-summary.tsx`
- Create: `src/features/dashboard/components/classification-chart.tsx`
- Create: `src/features/dashboard/components/activity-chart.tsx`
- Create: `src/features/dashboard/components/campaign-chart.tsx`
- Create: `src/features/dashboard/components/recent-replies-compact.tsx`

- [ ] **Step 1: Create dashboard-module.tsx**

```tsx
import { clsx } from 'clsx'
import { ChartSkeleton } from '@/components/ui/skeleton'

interface DashboardModuleProps {
  title: string
  children: React.ReactNode
  loading?: boolean
  error?: string | null
}

export function DashboardModule({ title, children, loading, error }: DashboardModuleProps) {
  return (
    <div
      className={clsx(
        'bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)]',
        'shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)]',
        'transition-all duration-[var(--transition-base)] p-4 flex flex-col',
      )}
    >
      <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wide mb-3">
        {title}
      </h3>
      {loading ? (
        <ChartSkeleton height={180} />
      ) : error ? (
        <div className="flex items-center justify-center py-8">
          <p className="text-[var(--status-danger)] text-xs">{error}</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0">{children}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create kpi-summary.tsx**

```tsx
import type { DashboardSummaryDTO } from '@/features/dashboard/server/get-dashboard-summary'

export function KpiSummary({ data }: { data: DashboardSummaryDTO }) {
  const positiveRate =
    data.replies > 0
      ? `${((data.positiveReplies / data.replies) * 100).toFixed(1)}%`
      : '—'

  const items = [
    { label: 'Leads', value: data.leads },
    { label: 'Campaigns', value: data.campaigns },
    { label: 'Sent', value: data.messagesSent },
    { label: 'Replies', value: data.replies, sub: `${positiveRate} positive` },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wide font-medium">{item.label}</p>
          <p className="text-[var(--text-primary)] text-2xl font-semibold tabular-nums">{item.value.toLocaleString()}</p>
          {item.sub && <p className="text-[var(--text-muted)] text-[10px]">{item.sub}</p>}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Create classification-chart.tsx**

```tsx
'use client'

import { LazyBarChart, LazyResponsiveContainer, XAxis, YAxis, Tooltip, Bar, Cell } from '@/components/charts/recharts-wrapper'
import type { ClassificationBreakdownDTO } from '@/features/analytics/types'
import type { ReplyClassification } from '@prisma/client'

const COLORS: Record<ReplyClassification, string> = {
  POSITIVE: 'var(--status-success)',
  NEGATIVE: 'var(--status-danger)',
  NEUTRAL: 'var(--text-secondary)',
  OUT_OF_OFFICE: 'var(--status-warning)',
  UNSUBSCRIBE_REQUEST: 'var(--status-danger)',
  REFERRAL: 'var(--accent-indigo)',
  UNKNOWN: 'var(--text-muted)',
}

export function ClassificationChart({ data }: { data: ClassificationBreakdownDTO[] }) {
  if (data.length === 0) {
    return <p className="text-[var(--text-muted)] text-xs text-center py-8">No replies classified yet</p>
  }

  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div>
      <LazyResponsiveContainer width="100%" height={180}>
        <LazyBarChart data={data} layout="vertical" margin={{ left: 80, right: 30 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="classification" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={75} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-surface-overlay)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.classification} fill={COLORS[entry.classification] ?? 'var(--text-muted)'} />
            ))}
          </Bar>
        </LazyBarChart>
      </LazyResponsiveContainer>
      <p className="text-[var(--text-muted)] text-[10px] text-center mt-1">{total} total replies</p>
    </div>
  )
}
```

- [ ] **Step 4: Create activity-chart.tsx**

```tsx
'use client'

import { LazyAreaChart, LazyResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Area } from '@/components/charts/recharts-wrapper'
import type { DailyActivityPoint } from '@/features/analytics/types'

export function ActivityChart({ data }: { data: DailyActivityPoint[] }) {
  if (data.length === 0 || data.every((d) => d.sent === 0 && d.replied === 0)) {
    return <p className="text-[var(--text-muted)] text-xs text-center py-8">No activity in this period</p>
  }

  return (
    <LazyResponsiveContainer width="100%" height={200}>
      <LazyAreaChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} width={30} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-surface-overlay)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-primary)' }}
        />
        <Area type="monotone" dataKey="sent" stroke="var(--accent-indigo)" fill="var(--accent-indigo)" fillOpacity={0.15} strokeWidth={2} />
        <Area type="monotone" dataKey="replied" stroke="var(--accent-cyan)" fill="var(--accent-cyan)" fillOpacity={0.15} strokeWidth={2} />
      </LazyAreaChart>
    </LazyResponsiveContainer>
  )
}
```

- [ ] **Step 5: Create campaign-chart.tsx**

```tsx
'use client'

import { LazyBarChart, LazyResponsiveContainer, XAxis, YAxis, Tooltip, Bar, CartesianGrid } from '@/components/charts/recharts-wrapper'
import type { CampaignPerformanceDTO } from '@/features/analytics/types'

export function CampaignChart({ data }: { data: CampaignPerformanceDTO[] }) {
  if (data.length === 0) {
    return <p className="text-[var(--text-muted)] text-xs text-center py-8">Create a campaign to compare performance</p>
  }

  const top5 = data.slice(0, 5).map((c) => ({
    name: c.name.length > 15 ? c.name.slice(0, 15) + '…' : c.name,
    sent: c.sent,
    replied: c.replied,
  }))

  return (
    <LazyResponsiveContainer width="100%" height={200}>
      <LazyBarChart data={top5} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} width={30} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-surface-overlay)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-primary)' }}
        />
        <Bar dataKey="sent" fill="var(--accent-indigo)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="replied" fill="var(--accent-cyan)" radius={[4, 4, 0, 0]} />
      </LazyBarChart>
    </LazyResponsiveContainer>
  )
}
```

- [ ] **Step 6: Create recent-replies-compact.tsx**

```tsx
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { ReplyWithLeadDTO } from '@/features/replies/types'
import type { ReplyClassification } from '@prisma/client'

const VARIANT: Record<ReplyClassification, 'success' | 'muted' | 'danger' | 'warning' | 'default'> = {
  POSITIVE: 'success',
  NEUTRAL: 'muted',
  NEGATIVE: 'danger',
  OUT_OF_OFFICE: 'warning',
  UNSUBSCRIBE_REQUEST: 'danger',
  REFERRAL: 'default',
  UNKNOWN: 'muted',
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  return `${Math.floor(diffHr / 24)}d`
}

export function RecentRepliesCompact({ replies }: { replies: ReplyWithLeadDTO[] }) {
  if (replies.length === 0) {
    return <p className="text-[var(--text-muted)] text-xs text-center py-8">No replies yet</p>
  }

  return (
    <div className="space-y-1">
      {replies.map((reply) => (
        <Link
          key={reply.id}
          href="/inbox"
          className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-btn)] hover:bg-[var(--bg-surface-raised)] transition-colors"
        >
          <span className="text-[var(--text-primary)] text-xs truncate flex-1">{reply.leadEmail}</span>
          <Badge variant={VARIANT[reply.classification]}>{reply.classification}</Badge>
          <span className="text-[var(--text-muted)] text-[10px] flex-shrink-0">{relativeTime(reply.receivedAt)}</span>
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Commit**

```bash
git add src/features/dashboard/components/
git commit -m "feat: add dashboard module card and chart components"
```

---

### Task 7: Dashboard Page + Client + Refresh Route

**Files:**
- Modify: `src/app/(dashboard)/dashboard/page.tsx`
- Create: `src/app/(dashboard)/dashboard/dashboard-client.tsx`
- Create: `src/app/api/dashboard/refresh/route.ts`

- [ ] **Step 1: Create refresh route**

Create `src/app/api/dashboard/refresh/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getDashboardSummary } from '@/features/dashboard/server/get-dashboard-summary'
import { getFunnelData } from '@/features/analytics/server/get-funnel-data'
import { getDailyActivity } from '@/features/analytics/server/get-daily-activity'
import { getClassificationBreakdown } from '@/features/analytics/server/get-classification-breakdown'
import { getCampaignPerformance } from '@/features/analytics/server/get-campaign-performance'
import { getReplies } from '@/features/replies/server/get-replies'

export async function GET(request: Request) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const org = await resolveOrganization(orgId)
  const url = new URL(request.url)
  const days = parseInt(url.searchParams.get('days') ?? '30', 10)

  const [summary, funnel, activity, classification, campaigns, { replies: recentReplies }] = await Promise.all([
    getDashboardSummary({ organizationId: org.id }),
    getFunnelData({ organizationId: org.id, days }),
    getDailyActivity({ organizationId: org.id, days }),
    getClassificationBreakdown({ organizationId: org.id, days }),
    getCampaignPerformance({ organizationId: org.id, days }),
    getReplies({ organizationId: org.id, limit: 5 }),
  ])

  return NextResponse.json({ summary, funnel, activity, classification, campaigns, recentReplies })
}
```

- [ ] **Step 2: Create dashboard-client.tsx**

Create `src/app/(dashboard)/dashboard/dashboard-client.tsx`:

```tsx
'use client'

import { useState, useCallback, useEffect } from 'react'
import { SnapshotBar } from '@/features/dashboard/components/snapshot-bar'
import { DashboardModule } from '@/features/dashboard/components/dashboard-module'
import { KpiSummary } from '@/features/dashboard/components/kpi-summary'
import { FunnelChart } from '@/components/charts/funnel-chart'
import { ClassificationChart } from '@/features/dashboard/components/classification-chart'
import { ActivityChart } from '@/features/dashboard/components/activity-chart'
import { CampaignChart } from '@/features/dashboard/components/campaign-chart'
import { RecentRepliesCompact } from '@/features/dashboard/components/recent-replies-compact'
import type { DashboardRefreshData } from '@/features/analytics/types'

interface DashboardClientProps {
  initialData: DashboardRefreshData
}

export function DashboardClient({ initialData }: DashboardClientProps) {
  const [data, setData] = useState(initialData)
  const [dateRange, setDateRange] = useState<'7d' | '30d'>('30d')
  const [isLive, setIsLive] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(new Date())

  const refresh = useCallback(async (days?: number) => {
    setRefreshing(true)
    try {
      const d = days ?? (dateRange === '7d' ? 7 : 30)
      const res = await fetch(`/api/dashboard/refresh?days=${d}`)
      if (res.ok) {
        const newData = await res.json() as DashboardRefreshData
        setData(newData)
        setLastUpdatedAt(new Date())
      }
    } finally {
      setRefreshing(false)
    }
  }, [dateRange])

  const handleDateRangeChange = useCallback((range: '7d' | '30d') => {
    setDateRange(range)
    void refresh(range === '7d' ? 7 : 30)
  }, [refresh])

  // Live mode polling
  useEffect(() => {
    if (!isLive) return
    const interval = setInterval(() => void refresh(), 60_000)
    return () => clearInterval(interval)
  }, [isLive, refresh])

  // Daily 8 AM auto-refresh
  useEffect(() => {
    const now = new Date()
    const next8am = new Date(now)
    next8am.setHours(8, 0, 0, 0)
    if (next8am <= now) next8am.setDate(next8am.getDate() + 1)
    const ms = next8am.getTime() - now.getTime()
    const timeout = setTimeout(() => void refresh(), ms)
    return () => clearTimeout(timeout)
  }, [refresh])

  return (
    <div className="space-y-6">
      <SnapshotBar
        lastUpdatedAt={lastUpdatedAt}
        dateRange={dateRange}
        isLive={isLive}
        onRefresh={() => void refresh()}
        onDateRangeChange={handleDateRangeChange}
        onLiveToggle={() => setIsLive((v) => !v)}
        refreshing={refreshing}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <DashboardModule title="KPI Summary" loading={refreshing}>
          <KpiSummary data={data.summary} />
        </DashboardModule>

        <DashboardModule title="Outreach Funnel" loading={refreshing}>
          <FunnelChart stages={data.funnel} size="compact" />
        </DashboardModule>

        <DashboardModule title="Reply Classification" loading={refreshing}>
          <ClassificationChart data={data.classification} />
        </DashboardModule>

        <DashboardModule title="Daily Activity" loading={refreshing}>
          <ActivityChart data={data.activity} />
        </DashboardModule>

        <DashboardModule title="Campaign Comparison" loading={refreshing}>
          <CampaignChart data={data.campaigns} />
        </DashboardModule>

        <DashboardModule title="Recent Replies" loading={refreshing}>
          <RecentRepliesCompact replies={data.recentReplies} />
        </DashboardModule>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update dashboard page.tsx**

Replace the entire contents of `src/app/(dashboard)/dashboard/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { DashboardClient } from './dashboard-client'
import { getDashboardSummary } from '@/features/dashboard/server/get-dashboard-summary'
import { getFunnelData } from '@/features/analytics/server/get-funnel-data'
import { getDailyActivity } from '@/features/analytics/server/get-daily-activity'
import { getClassificationBreakdown } from '@/features/analytics/server/get-classification-breakdown'
import { getCampaignPerformance } from '@/features/analytics/server/get-campaign-performance'
import { getReplies } from '@/features/replies/server/get-replies'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function DashboardPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/sign-in')
  }

  const org = await resolveOrganization(orgId)

  const [summary, funnel, activity, classification, campaigns, { replies: recentReplies }] = await Promise.all([
    getDashboardSummary({ organizationId: org.id }),
    getFunnelData({ organizationId: org.id }),
    getDailyActivity({ organizationId: org.id }),
    getClassificationBreakdown({ organizationId: org.id }),
    getCampaignPerformance({ organizationId: org.id }),
    getReplies({ organizationId: org.id, limit: 5 }),
  ])

  return (
    <>
      <Header title="Dashboard" />
      <div className="flex-1 p-6">
        <DashboardClient
          initialData={{ summary, funnel, activity, classification, campaigns, recentReplies }}
        />
      </div>
    </>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/dashboard/page.tsx src/app/(dashboard)/dashboard/dashboard-client.tsx src/app/api/dashboard/refresh/route.ts
git commit -m "feat: redesign dashboard page with modular workspace layout"
```

---

### Task 8: Analytics Components — KPI Strip, Activity Line Chart, Campaign Table, Classification Bars

**Files:**
- Create: `src/features/analytics/components/kpi-strip.tsx`
- Create: `src/features/analytics/components/activity-line-chart.tsx`
- Create: `src/features/analytics/components/campaign-table.tsx`
- Create: `src/features/analytics/components/classification-bars.tsx`

- [ ] **Step 1: Create kpi-strip.tsx**

```tsx
'use client'

import type { AnalyticsDTO } from '../types'

interface KpiChipProps {
  label: string
  value: number
  accent: string
  index: number
}

function KpiChip({ label, value, accent, index }: KpiChipProps) {
  return (
    <div
      className="flex items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-full px-4 py-2 shadow-[var(--shadow-card)]"
      style={{
        borderLeftWidth: 3,
        borderLeftColor: accent,
        animationDelay: `${index * 80}ms`,
      }}
    >
      <div>
        <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wide font-medium">{label}</p>
        <p className="text-[var(--text-primary)] text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
      </div>
    </div>
  )
}

export function KpiStrip({ analytics }: { analytics: AnalyticsDTO }) {
  const chips = [
    { label: 'Sent', value: analytics.sent, accent: 'var(--accent-indigo)' },
    { label: 'Delivered', value: analytics.delivered, accent: 'var(--accent-cyan)' },
    { label: 'Opened', value: analytics.opened, accent: 'var(--accent-magenta)' },
    { label: 'Clicked', value: analytics.clicked, accent: 'var(--accent-cyan)' },
    { label: 'Replies', value: analytics.replies, accent: 'var(--status-success)' },
    { label: 'Positive', value: analytics.positiveReplies, accent: 'var(--status-success)' },
    { label: 'Bounced', value: analytics.bounced, accent: 'var(--status-danger)' },
    { label: 'Unsubs', value: analytics.unsubscribes, accent: 'var(--status-danger)' },
  ]

  return (
    <div className="flex flex-wrap gap-3">
      {chips.map((chip, i) => (
        <KpiChip key={chip.label} {...chip} index={i} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Create activity-line-chart.tsx**

```tsx
'use client'

import { LazyAreaChart, LazyResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Area, Legend } from '@/components/charts/recharts-wrapper'
import type { DailyActivityExtendedPoint } from '../types'

export function ActivityLineChart({ data }: { data: DailyActivityExtendedPoint[] }) {
  if (data.length === 0 || data.every((d) => d.sent === 0 && d.delivered === 0 && d.opened === 0 && d.replied === 0)) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[var(--text-muted)] text-sm">No activity in the selected period</p>
      </div>
    )
  }

  return (
    <LazyResponsiveContainer width="100%" height={320}>
      <LazyAreaChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} width={35} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-surface-overlay)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-primary)' }}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }}
        />
        <Area type="monotone" dataKey="sent" stroke="var(--accent-indigo)" fill="var(--accent-indigo)" fillOpacity={0.12} strokeWidth={2} name="Sent" />
        <Area type="monotone" dataKey="delivered" stroke="var(--accent-cyan)" fill="var(--accent-cyan)" fillOpacity={0.08} strokeWidth={2} name="Delivered" />
        <Area type="monotone" dataKey="opened" stroke="var(--accent-magenta)" fill="var(--accent-magenta)" fillOpacity={0.08} strokeWidth={2} name="Opened" />
        <Area type="monotone" dataKey="replied" stroke="var(--status-success)" fill="var(--status-success)" fillOpacity={0.08} strokeWidth={2} name="Replied" />
      </LazyAreaChart>
    </LazyResponsiveContainer>
  )
}
```

- [ ] **Step 3: Create campaign-table.tsx**

```tsx
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { CampaignPerformanceDTO } from '../types'
import type { CampaignStatus } from '@prisma/client'

const STATUS_VARIANT: Record<CampaignStatus, 'default' | 'success' | 'warning' | 'muted'> = {
  DRAFT: 'muted',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'default',
  ARCHIVED: 'muted',
}

type SortKey = 'sent' | 'delivered' | 'opened' | 'replied' | 'openRate' | 'replyRate'

function InlineBar({ value, max }: { value: number; max: number }) {
  const width = max === 0 ? 0 : Math.min((value / max) * 100, 100)
  return (
    <div className="flex items-center gap-2">
      <span className="text-[var(--text-primary)] text-xs tabular-nums w-8 text-right">{value}</span>
      <div className="flex-1 h-1.5 bg-[var(--bg-surface-raised)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--accent-indigo)] rounded-full transition-all duration-500"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

export function CampaignTable({ data }: { data: CampaignPerformanceDTO[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('sent')
  const [sortAsc, setSortAsc] = useState(false)

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[var(--text-muted)] text-sm">No campaigns with activity yet</p>
      </div>
    )
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const sorted = [...data].sort((a, b) => {
    const diff = (a[sortKey] as number) - (b[sortKey] as number)
    return sortAsc ? diff : -diff
  })

  const maxSent = Math.max(...data.map((c) => c.sent), 1)

  function SortHeader({ label, field }: { label: string; field: SortKey }) {
    return (
      <th
        className="text-left py-3 px-3 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide cursor-pointer hover:text-[var(--text-secondary)] transition-colors select-none"
        onClick={() => handleSort(field)}
      >
        {label} {sortKey === field ? (sortAsc ? '↑' : '↓') : ''}
      </th>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[var(--bg-surface)] z-10">
          <tr className="border-b border-[var(--border-default)]">
            <th className="text-left py-3 px-3 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Campaign</th>
            <th className="text-left py-3 px-3 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
            <SortHeader label="Sent" field="sent" />
            <SortHeader label="Delivered" field="delivered" />
            <SortHeader label="Opened" field="opened" />
            <SortHeader label="Replied" field="replied" />
            <SortHeader label="Positive %" field="replyRate" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((campaign, i) => (
            <tr
              key={campaign.id}
              className={[
                'border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]',
                i === 0 ? 'border-l-2 border-l-[var(--accent-indigo)]' : '',
              ].join(' ')}
            >
              <td className="py-3 px-3">
                <Link href={`/campaigns/${campaign.id}`} className="text-[var(--text-primary)] text-xs font-medium hover:text-[var(--accent-indigo-hover)] transition-colors">
                  {campaign.name}
                </Link>
              </td>
              <td className="py-3 px-3">
                <Badge variant={STATUS_VARIANT[campaign.status]}>{campaign.status}</Badge>
              </td>
              <td className="py-3 px-3"><InlineBar value={campaign.sent} max={maxSent} /></td>
              <td className="py-3 px-3"><InlineBar value={campaign.delivered} max={maxSent} /></td>
              <td className="py-3 px-3"><InlineBar value={campaign.opened} max={maxSent} /></td>
              <td className="py-3 px-3"><InlineBar value={campaign.replied} max={maxSent} /></td>
              <td className="py-3 px-3">
                <span className={`text-xs font-medium tabular-nums ${
                  campaign.replyRate >= 0.5 ? 'text-[var(--status-success)]' :
                  campaign.replyRate >= 0.25 ? 'text-[var(--status-warning)]' :
                  'text-[var(--status-danger)]'
                }`}>
                  {(campaign.replyRate * 100).toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Create classification-bars.tsx**

```tsx
'use client'

import { LazyBarChart, LazyResponsiveContainer, XAxis, YAxis, Tooltip, Bar, Cell } from '@/components/charts/recharts-wrapper'
import type { ClassificationBreakdownDTO } from '../types'
import type { ReplyClassification } from '@prisma/client'

const COLORS: Record<ReplyClassification, string> = {
  POSITIVE: 'var(--status-success)',
  NEGATIVE: 'var(--status-danger)',
  NEUTRAL: 'var(--text-secondary)',
  OUT_OF_OFFICE: 'var(--status-warning)',
  UNSUBSCRIBE_REQUEST: 'var(--status-danger)',
  REFERRAL: 'var(--accent-indigo)',
  UNKNOWN: 'var(--text-muted)',
}

export function ClassificationBars({ data, totalReplies }: { data: ClassificationBreakdownDTO[]; totalReplies: number }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[var(--text-muted)] text-sm">No replies classified yet</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[var(--text-muted)] text-xs mb-3">
        {data.reduce((s, d) => s + d.count, 0)} classifications from {totalReplies} total replies
      </p>
      <LazyResponsiveContainer width="100%" height={240}>
        <LazyBarChart data={data} layout="vertical" margin={{ left: 100, right: 30 }}>
          <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
          <YAxis type="category" dataKey="classification" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={95} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-surface-overlay)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.classification} fill={COLORS[entry.classification] ?? 'var(--text-muted)'} />
            ))}
          </Bar>
        </LazyBarChart>
      </LazyResponsiveContainer>
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add src/features/analytics/components/kpi-strip.tsx src/features/analytics/components/activity-line-chart.tsx src/features/analytics/components/campaign-table.tsx src/features/analytics/components/classification-bars.tsx
git commit -m "feat: add analytics KPI strip, activity chart, campaign table, and classification bars"
```

---

### Task 9: Analytics Page + Client + Refresh Route

**Files:**
- Modify: `src/app/(dashboard)/analytics/page.tsx`
- Create: `src/app/(dashboard)/analytics/analytics-client.tsx`
- Create: `src/app/api/analytics/refresh/route.ts`

- [ ] **Step 1: Create refresh route**

Create `src/app/api/analytics/refresh/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getAnalytics } from '@/features/analytics/server/get-analytics'
import { getFunnelData } from '@/features/analytics/server/get-funnel-data'
import { getDailyActivityExtended } from '@/features/analytics/server/get-daily-activity-extended'
import { getCampaignPerformance } from '@/features/analytics/server/get-campaign-performance'
import { getClassificationBreakdown } from '@/features/analytics/server/get-classification-breakdown'

export async function GET(request: Request) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const org = await resolveOrganization(orgId)
  const url = new URL(request.url)
  const days = parseInt(url.searchParams.get('days') ?? '30', 10)

  const [analytics, funnel, activity, campaigns, classification] = await Promise.all([
    getAnalytics({ organizationId: org.id }),
    getFunnelData({ organizationId: org.id, days }),
    getDailyActivityExtended({ organizationId: org.id, days }),
    getCampaignPerformance({ organizationId: org.id, days }),
    getClassificationBreakdown({ organizationId: org.id, days }),
  ])

  return NextResponse.json({ analytics, funnel, activity, campaigns, classification })
}
```

- [ ] **Step 2: Create analytics-client.tsx**

Create `src/app/(dashboard)/analytics/analytics-client.tsx`:

```tsx
'use client'

import { useState, useCallback, useEffect } from 'react'
import { SnapshotBar } from '@/features/dashboard/components/snapshot-bar'
import { KpiStrip } from '@/features/analytics/components/kpi-strip'
import { FunnelChart } from '@/components/charts/funnel-chart'
import { ActivityLineChart } from '@/features/analytics/components/activity-line-chart'
import { CampaignTable } from '@/features/analytics/components/campaign-table'
import { ClassificationBars } from '@/features/analytics/components/classification-bars'
import { DashboardModule } from '@/features/dashboard/components/dashboard-module'
import type { AnalyticsRefreshData } from '@/features/analytics/types'

interface AnalyticsClientProps {
  initialData: AnalyticsRefreshData
}

export function AnalyticsClient({ initialData }: AnalyticsClientProps) {
  const [data, setData] = useState(initialData)
  const [dateRange, setDateRange] = useState<'7d' | '30d'>('30d')
  const [isLive, setIsLive] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState(new Date())

  const refresh = useCallback(async (days?: number) => {
    setRefreshing(true)
    try {
      const d = days ?? (dateRange === '7d' ? 7 : 30)
      const res = await fetch(`/api/analytics/refresh?days=${d}`)
      if (res.ok) {
        const newData = await res.json() as AnalyticsRefreshData
        setData(newData)
        setLastUpdatedAt(new Date())
      }
    } finally {
      setRefreshing(false)
    }
  }, [dateRange])

  const handleDateRangeChange = useCallback((range: '7d' | '30d') => {
    setDateRange(range)
    void refresh(range === '7d' ? 7 : 30)
  }, [refresh])

  useEffect(() => {
    if (!isLive) return
    const interval = setInterval(() => void refresh(), 60_000)
    return () => clearInterval(interval)
  }, [isLive, refresh])

  useEffect(() => {
    const now = new Date()
    const next8am = new Date(now)
    next8am.setHours(8, 0, 0, 0)
    if (next8am <= now) next8am.setDate(next8am.getDate() + 1)
    const timeout = setTimeout(() => void refresh(), next8am.getTime() - now.getTime())
    return () => clearTimeout(timeout)
  }, [refresh])

  return (
    <div className="space-y-8">
      <SnapshotBar
        lastUpdatedAt={lastUpdatedAt}
        dateRange={dateRange}
        isLive={isLive}
        onRefresh={() => void refresh()}
        onDateRangeChange={handleDateRangeChange}
        onLiveToggle={() => setIsLive((v) => !v)}
        refreshing={refreshing}
      />

      <KpiStrip analytics={data.analytics} />

      <DashboardModule title="Outreach Funnel" loading={refreshing}>
        <FunnelChart stages={data.funnel} size="full" />
      </DashboardModule>

      <DashboardModule title="Daily Activity" loading={refreshing}>
        <ActivityLineChart data={data.activity} />
      </DashboardModule>

      <DashboardModule title="Campaign Performance" loading={refreshing}>
        <CampaignTable data={data.campaigns} />
      </DashboardModule>

      <DashboardModule title="Reply Classification" loading={refreshing}>
        <ClassificationBars data={data.classification} totalReplies={data.analytics.replies} />
      </DashboardModule>

      <p className="text-[var(--text-muted)] text-xs leading-relaxed">
        Delivered, opened, clicked, bounced, and unsubscribe counts reflect unique emails (one message counted once per event type regardless of how many events were received). Positive replies are classified by AI.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Update analytics page.tsx**

Replace the entire contents of `src/app/(dashboard)/analytics/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { AnalyticsClient } from './analytics-client'
import { getAnalytics } from '@/features/analytics/server/get-analytics'
import { getFunnelData } from '@/features/analytics/server/get-funnel-data'
import { getDailyActivityExtended } from '@/features/analytics/server/get-daily-activity-extended'
import { getCampaignPerformance } from '@/features/analytics/server/get-campaign-performance'
import { getClassificationBreakdown } from '@/features/analytics/server/get-classification-breakdown'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function AnalyticsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)

  const [analytics, funnel, activity, campaigns, classification] = await Promise.all([
    getAnalytics({ organizationId: org.id }),
    getFunnelData({ organizationId: org.id }),
    getDailyActivityExtended({ organizationId: org.id }),
    getCampaignPerformance({ organizationId: org.id }),
    getClassificationBreakdown({ organizationId: org.id }),
  ])

  return (
    <>
      <Header title="Analytics" />
      <div className="flex-1 p-6">
        <AnalyticsClient
          initialData={{ analytics, funnel, activity, campaigns, classification }}
        />
      </div>
    </>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/app/(dashboard)/analytics/page.tsx src/app/(dashboard)/analytics/analytics-client.tsx src/app/api/analytics/refresh/route.ts
git commit -m "feat: redesign analytics page with executive command center layout"
```

---

### Task 10: Build Verification

- [ ] **Step 1: Run full build**

Run: `cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run 2>&1 | tail -15`
Expected: All tests pass.

- [ ] **Step 3: Fix any issues**

Common issues:
- Recharts SSR errors (should be handled by dynamic imports)
- TypeScript mismatches between DTOs
- Missing Prisma imports

- [ ] **Step 4: Final commit if fixes needed**
