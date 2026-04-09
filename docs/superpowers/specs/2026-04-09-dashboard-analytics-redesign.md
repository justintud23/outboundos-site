# Dashboard & Analytics Visual Redesign — Design Spec

**Date:** 2026-04-09
**Goal:** Redesign the Dashboard (Modular Workspace) and Analytics (Executive Command Center + Analytical Depth) pages with real charts, time-series data, and a snapshot/refresh system.
**Constraints:** No schema changes, no business logic changes. New read-only query functions allowed. Recharts for charting.

---

## Section 1: New Data Query Functions

All in `src/features/analytics/server/`. All org-scoped, read-only, sorted, zero-filled.

### getDailyActivity

**File:** `get-daily-activity.ts`

```typescript
interface DailyActivityPoint {
  date: string        // "2026-04-01"
  sent: number
  replied: number
}

getDailyActivity(input: { organizationId: string; days?: number }): Promise<DailyActivityPoint[]>
```

- Default `days = 30`
- Query OutboundMessage grouped by `DATE_TRUNC('day', sentAt)` and InboundReply grouped by `DATE_TRUNC('day', receivedAt)`
- Merge into array, zero-fill missing days
- Sorted by date ASC
- Uses `@@index([organizationId, sentAt])` and `@@index([organizationId, receivedAt])` (already exist)

### getCampaignPerformance

**File:** `get-campaign-performance.ts`

```typescript
interface CampaignPerformanceDTO {
  id: string
  name: string
  status: CampaignStatus
  sent: number
  delivered: number
  opened: number
  replied: number
  positiveReplies: number
  openRate: number      // 0-1, 0 if sent=0
  replyRate: number     // 0-1, 0 if sent=0
}

getCampaignPerformance(input: { organizationId: string; days?: number }): Promise<CampaignPerformanceDTO[]>
```

- Fetch campaigns with `_count` of outboundMessages
- Aggregated queries for delivered/opened per campaign (MessageEvent groupBy with campaign relation)
- Reply counts via InboundReply with outboundMessage.campaignId filter
- Rates: `delivered / sent`, guarded with `sent === 0 ? 0` 
- Sorted by sent DESC, limited to top 10
- No N+1: use parallel groupBy queries then merge in server layer

### getClassificationBreakdown

**File:** `get-classification-breakdown.ts`

```typescript
interface ClassificationBreakdownDTO {
  classification: ReplyClassification
  count: number
}

getClassificationBreakdown(input: { organizationId: string; days?: number }): Promise<ClassificationBreakdownDTO[]>
```

- `inboundReply.groupBy({ by: ['classification'], _count: { _all: true } })`
- Sorted by count DESC

### getFunnelData

**File:** `get-funnel-data.ts`

```typescript
interface FunnelStageDTO {
  stage: string
  count: number
  rate: number          // 0-1, relative to sent (first stage)
}

getFunnelData(input: { organizationId: string; days?: number }): Promise<FunnelStageDTO[]>
```

- 5 stages: Sent → Delivered → Opened → Replied → Interested
- Sent: OutboundMessage count
- Delivered/Opened: unique outboundMessageIds from MessageEvent where eventType matches
- Replied: InboundReply count
- Interested: Lead count where status = INTERESTED
- Rate: `stageCount / sentCount`, guarded for zero
- Sorted in funnel order (not by count)

### getDailyActivityExtended

**File:** `get-daily-activity-extended.ts`

```typescript
interface DailyActivityExtendedPoint {
  date: string
  sent: number
  delivered: number
  opened: number
  replied: number
}

getDailyActivityExtended(input: { organizationId: string; days?: number }): Promise<DailyActivityExtendedPoint[]>
```

- Same as getDailyActivity but with 4 series for the analytics multi-line chart
- Delivered/opened: MessageEvent grouped by date of providerTimestamp
- Default days = 30, zero-filled, sorted ASC

---

## Section 2: Dashboard Page (Modular Workspace)

### Architecture

- Server component fetches all data in parallel, passes to client
- Client manages per-module loading/error states independently
- SnapshotBar controls date range and refresh
- Each module card is a `DashboardModule` wrapper

### Module Grid

2x3 on desktop (`lg:grid-cols-3`), 1-column on mobile. Gap: 16px.

| Module | Component | Data |
|---|---|---|
| KPI Summary | `kpi-summary.tsx` | `getDashboardSummary()` |
| Outreach Funnel | shared `funnel-chart.tsx` | `getFunnelData()` |
| Reply Classification | `classification-chart.tsx` | `getClassificationBreakdown()` |
| Daily Activity | `activity-chart.tsx` | `getDailyActivity()` |
| Campaign Comparison | `campaign-chart.tsx` | `getCampaignPerformance()` (top 5) |
| Recent Replies | `RepliesTable` (existing) | `getReplies({ limit: 5 })` |

### DashboardModule Component

```typescript
interface DashboardModuleProps {
  title: string
  children: React.ReactNode
  loading?: boolean
  error?: string | null
  onExpand?: () => void
  expanded?: boolean
}
```

- Card: `--bg-surface`, `--border-default`, `--radius-card`, `--shadow-card`
- Hover: `--shadow-card-hover`, `--border-glow`
- Title bar: title (left) + expand icon (right, Maximize2 from lucide)
- Expand: renders children in full-width panel below the grid (not a modal)
- Loading: skeleton overlay
- Error: inline error message with retry

### KPI Summary Module

4 stats in 2x2 mini-grid: Leads, Campaigns, Messages Sent, Replies
- Each: label (11px uppercase muted), value (28px semibold), sub-text (rate/trend)
- Positive rate shown on Replies

### Outreach Funnel Module

Custom CSS funnel (no Recharts needed):
- 5 horizontal bars with widths proportional to counts
- First bar (Sent) = 100% width, others scale proportionally
- Gradient fill: indigo → cyan across stages
- Labels: stage name (left), count + rate (right)
- Width animation on load (bars grow from 0 to target width)
- Hover: highlight stage with brighter glow

### Classification Chart Module

Recharts `BarChart` (horizontal):
- One bar per classification, sorted by count DESC
- Colors mapped to classification: POSITIVE=success, NEGATIVE=danger, NEUTRAL=muted, etc.
- Labels on bars showing count
- Total replies context text below chart

### Activity Chart Module

Recharts `AreaChart`:
- Two series: sent (indigo fill), replied (cyan fill)
- 30-day x-axis with date labels
- Tooltip: date + sent + replied counts
- Low-opacity area fill under lines

### Campaign Chart Module

Recharts `BarChart`:
- Top 5 campaigns
- Grouped bars: sent (indigo) + replied (cyan) side by side
- Campaign name on y-axis (horizontal bars) or x-axis (vertical bars)
- Tooltip: campaign name + sent + replied + reply rate

### Recent Replies Module

Compact presentation (not full RepliesTable):
- 5 most recent replies as compact list items
- Each item: lead email, classification badge, relative timestamp ("2h ago"), unread dot
- No table headers — lightweight stacked list
- Click item navigates to /inbox

### SnapshotBar Component

Shared between Dashboard and Analytics:

```typescript
interface SnapshotBarProps {
  lastUpdatedAt: Date
  dateRange: '7d' | '30d'
  isLive: boolean
  onRefresh: () => void
  onDateRangeChange: (range: '7d' | '30d') => void
  onLiveToggle: () => void
  refreshing: boolean
}
```

- Left: date range toggle pills (7d / 30d)
- Center: "Last updated at 8:03 AM"
- Right: Live toggle (green dot when on) + Refresh button (spins when refreshing)
- Daily auto-refresh: on mount, calculate ms until next 8 AM in user's local timezone, setTimeout
- All timestamps displayed in user-local time (toLocaleTimeString)

### Refresh Behavior

- Refresh orchestrated at page/client level via single `/api/dashboard/refresh` route
- Refresh button triggers one fetch, client distributes updated data to all modules
- Each module shows its own skeleton during refresh (keyed off global `refreshing` state)
- Live mode: setInterval 60s calls the single refresh route
- Auto-refresh: setTimeout to next 8 AM in user's local timezone (detected via `Intl.DateTimeFormat().resolvedOptions().timeZone`)

### Module Expansion

Optional for v1 — expansion via full-width panel is deferred. Modules render at fixed card size only. Expand icon hidden in v1.

### API Route for Client Refresh

Single page-level refresh route:
- `GET /api/dashboard/refresh?days=30` → calls all 6 server functions in parallel, returns combined JSON

Refresh orchestrated at page/client level — one fetch replaces all data at once. No per-module network fetching.

### Empty States

Each module has its own empty state when data is 0/empty:
- KPI: shows 0 values (no special empty state)
- Funnel: "Send your first outreach to see your pipeline funnel"
- Classification: "No replies classified yet"
- Activity: "No activity in the last 30 days"
- Campaigns: "Create a campaign to compare performance"
- Replies: "No replies yet" (existing)

---

## Section 3: Analytics Page (Executive Command Center + Analytical Depth)

### Architecture

Same pattern: server fetches → client manages. Shares SnapshotBar with dashboard.

### Layout (Vertical Scroll)

1. **SnapshotBar** — date range + refresh + live toggle
2. **KPI Strip** — 8 horizontal chips
3. **Insight Line** — auto-generated summary sentence
4. **Hero Funnel** — full-width, same component as dashboard but larger
5. **Activity Line Chart** — full-width, 4 series, toggleable legend
6. **Campaign Performance Table** — full-width sortable table
7. **Classification Breakdown** — horizontal bars with total context
8. **Footer note** — methodology

### KPI Strip

8 chips in horizontal row (flex-wrap on mobile):
- Sent, Delivered, Opened, Clicked, Replies, Positive, Bounced, Unsubscribes
- Each chip: pill-shaped, accent left-border
- Content: label, value, % change vs previous equal-length period
  - Comparison: current N days vs prior N days (e.g., 30d = compare last 30d to 30d before that)
  - Math: `((current - previous) / previous) * 100`, display as "+12%" or "-5%"
  - If previous = 0 and current > 0: show "+100%"
  - If previous = 0 and current = 0: show "—"
  - Color: green for positive change, red for negative, muted for zero
- 7-day sparkline inside each chip (using getDailyActivityExtended data, sampled)
- Staggered fade-in animation on load
- Clickable (future: filter page by metric — for now, visual feedback only)

### Insight Line

Auto-generated from data:
- "Your open rate is 68% — 12% above average this period"
- Logic: pick the most notable stat (highest rate, biggest change)
- Falls back to "X emails sent in the last N days" if no notable insight

### Hero Funnel

Same `FunnelChart` component but rendered full-width:
- Larger bars, more padding
- "→ 72%" labels between stages showing step-to-step conversion
- Width animation on load
- Hover highlights stage

### Activity Line Chart

Recharts `LineChart` (or `AreaChart`):
- 4 series: Sent (indigo), Delivered (cyan), Opened (magenta), Replied (green/success)
- Toggleable legend: click series name to show/hide
- Consistent y-axis scaling (single axis, all series share scale)
- Tooltip: vertical crosshair with all values for that day
- Low-opacity area fill
- Staggered draw animation
- Date range controlled by SnapshotBar (7d / 30d)

### Campaign Performance Table

Full-width sortable table component:

| Column | Render |
|---|---|
| Campaign | Link text → `/campaigns/[id]` |
| Status | Badge (existing component) |
| Sent | Number (right-aligned, tabular) |
| Delivered | Number + inline bar (% of sent, capped at 100%) |
| Opened | Number + inline bar (% of sent, capped at 100%) |
| Replied | Number + inline bar (% of sent, capped at 100%) |
| Positive Rate | Percentage + color (green if ≥50%, amber if ≥25%, red if <25%) |

- Sticky header on scroll
- Sortable by clicking column headers (ascending/descending toggle with indicator arrow)
- Inline bars: thin bars normalized to max rate in the column (not necessarily 100%)
- Alternating row backgrounds
- Empty state: "No campaigns with activity yet"
- Top campaign highlight: first row has subtle glow border

### Classification Breakdown

Recharts `BarChart` (horizontal):
- Same as dashboard classification chart but full-width
- Shows total replies count as context header: "8 classifications from 23 total replies"
- Bars sorted by count DESC

### API Route for Client Refresh

Single page-level refresh route:
- `GET /api/analytics/refresh?days=30` → calls all analytics server functions in parallel, returns combined JSON

Refresh orchestrated at page/client level — one fetch replaces all data.

### Empty States

- KPI Strip: shows 0 values, sparklines show flat lines
- Funnel: "Send your first outreach to see your pipeline"
- Activity chart: "No activity in the selected period" with muted chart area
- Campaign table: "No campaigns with outreach activity yet"
- Classification: "No replies classified yet"

---

## Section 4: Shared Components

### Charts Wrapper

`src/components/charts/recharts-wrapper.tsx`:
- Dynamic import of Recharts components (`next/dynamic` with `ssr: false`)
- Loading skeleton while chart JS loads
- Exports: `LazyAreaChart`, `LazyBarChart`, `LazyLineChart`, etc.

### Funnel Chart

`src/components/charts/funnel-chart.tsx`:
- Reused by both Dashboard (compact) and Analytics (full-width)
- Props: `stages: FunnelStageDTO[]`, `size: 'compact' | 'full'`
- CSS-based bars with width animation
- Gradient fill indigo → cyan

### Skeleton Components

`src/components/ui/skeleton.tsx`:
- `ChartSkeleton` — animated placeholder for chart areas
- `TableSkeleton` — animated placeholder for table rows

### Dependencies

- `recharts` — install as new dependency
- No other new libraries

---

## File Summary

### Create (26 files):

**Server functions (5):**
- `src/features/analytics/server/get-daily-activity.ts`
- `src/features/analytics/server/get-daily-activity-extended.ts`
- `src/features/analytics/server/get-campaign-performance.ts`
- `src/features/analytics/server/get-classification-breakdown.ts`
- `src/features/analytics/server/get-funnel-data.ts`

**API routes (2):**
- `src/app/api/dashboard/refresh/route.ts`
- `src/app/api/analytics/refresh/route.ts`

**Shared components (3):**
- `src/components/charts/recharts-wrapper.tsx`
- `src/components/charts/funnel-chart.tsx`
- `src/components/ui/skeleton.tsx`

**Dashboard components (7):**
- `src/app/(dashboard)/dashboard/dashboard-client.tsx`
- `src/features/dashboard/components/dashboard-module.tsx`
- `src/features/dashboard/components/kpi-summary.tsx`
- `src/features/dashboard/components/classification-chart.tsx`
- `src/features/dashboard/components/activity-chart.tsx`
- `src/features/dashboard/components/campaign-chart.tsx`
- `src/features/dashboard/components/snapshot-bar.tsx`

**Analytics components (5):**
- `src/app/(dashboard)/analytics/analytics-client.tsx`
- `src/features/analytics/components/kpi-strip.tsx`
- `src/features/analytics/components/activity-line-chart.tsx`
- `src/features/analytics/components/campaign-table.tsx`
- `src/features/analytics/components/classification-bars.tsx`

### Modify (3 files):
- `src/app/(dashboard)/dashboard/page.tsx`
- `src/app/(dashboard)/analytics/page.tsx`
- `src/features/analytics/types.ts`
