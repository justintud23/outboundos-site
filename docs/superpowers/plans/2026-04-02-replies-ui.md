# Replies UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/replies` dashboard page that shows org-scoped inbound replies in a filterable, sorted table with classification highlighting.

**Architecture:** Follow the established server-component-as-data-fetcher + thin client pattern used by `/leads` and `/drafts`. Business logic lives in `src/features/replies/server/`. The page server component fetches data at render time and passes it to a `'use client'` wrapper that owns filter state. No new API routes.

**Tech Stack:** Next.js 16 (App Router), React 19, Prisma v7, Clerk (auth), Tailwind v4, Lucide React icons, Vitest

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/features/replies/types.ts` | Modify | Add `ReplyWithLeadDTO` extending `InboundReplyDTO` with `leadEmail` |
| `src/features/replies/server/get-replies.ts` | Create | Org-scoped paginated query with optional classification filter |
| `src/features/replies/server/get-replies.test.ts` | Create | Unit tests for `getReplies` |
| `src/features/replies/components/replies-table.tsx` | Create | Pure table — rows, classification badges, row highlighting |
| `src/app/(dashboard)/replies/replies-client.tsx` | Create | `'use client'` wrapper owning filter dropdown state |
| `src/app/(dashboard)/replies/page.tsx` | Create | Server component: auth guard + data fetch |
| `src/components/layout/sidebar.tsx` | Modify | Add Replies nav item with `MessageSquare` icon |

---

## Task 1: Add `ReplyWithLeadDTO` to types

**Files:**
- Modify: `src/features/replies/types.ts`

- [ ] **Step 1: Add the type**

Open `src/features/replies/types.ts`. After the `InboundReplyDTO` interface, add the `ReplyWithLeadDTO` interface. The full updated file:

```typescript
import type { ReplyClassification } from '@prisma/client'

export interface InboundReplyDTO {
  id: string
  organizationId: string
  leadId: string
  outboundMessageId: string | null
  rawBody: string
  classification: ReplyClassification
  classificationConfidence: number | null
  receivedAt: Date
  createdAt: Date
}

export interface ReplyWithLeadDTO extends InboundReplyDTO {
  leadEmail: string
}

export class LeadNotFoundByEmailError extends Error {
  constructor(public readonly email: string) {
    super(`No lead found with email: ${email}`)
    this.name = 'LeadNotFoundByEmailError'
    Object.setPrototypeOf(this, LeadNotFoundByEmailError.prototype)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/replies/types.ts
git commit -m "feat: add ReplyWithLeadDTO type"
```

---

## Task 2: `getReplies` server function (TDD)

**Files:**
- Create: `src/features/replies/server/get-replies.ts`
- Create: `src/features/replies/server/get-replies.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/features/replies/server/get-replies.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    inboundReply: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getReplies } from './get-replies'

const mockFindMany = prisma.inboundReply.findMany as ReturnType<typeof vi.fn>
const mockCount    = prisma.inboundReply.count    as ReturnType<typeof vi.fn>

const baseRow = {
  id: 'reply-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  outboundMessageId: null,
  rawBody: 'Sounds great!',
  classification: 'POSITIVE' as const,
  classificationConfidence: 0.92,
  receivedAt: new Date('2026-04-01T10:00:00Z'),
  createdAt: new Date('2026-04-01T10:00:00Z'),
  lead: { email: 'test@example.com' },
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getReplies', () => {
  it('returns replies with leadEmail and correct total', async () => {
    mockFindMany.mockResolvedValue([baseRow])
    mockCount.mockResolvedValue(1)

    const result = await getReplies({ organizationId: 'org-1' })

    expect(result.replies).toHaveLength(1)
    expect(result.replies[0].leadEmail).toBe('test@example.com')
    expect(result.total).toBe(1)
  })

  it('queries by organizationId and orders by receivedAt desc', async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await getReplies({ organizationId: 'org-1' })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1' },
      orderBy: { receivedAt: 'desc' },
      include: { lead: { select: { email: true } } },
    }))
  })

  it('adds classification to where clause when provided', async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await getReplies({ organizationId: 'org-1', classification: 'POSITIVE' })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId: 'org-1', classification: 'POSITIVE' },
    }))
    expect(mockCount).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', classification: 'POSITIVE' },
    })
  })

  it('caps limit at 200', async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await getReplies({ organizationId: 'org-1', limit: 500 })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }))
  })

  it('respects offset for pagination', async () => {
    mockFindMany.mockResolvedValue([])
    mockCount.mockResolvedValue(0)

    await getReplies({ organizationId: 'org-1', offset: 50 })

    expect(mockFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 50 }))
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
npx vitest run src/features/replies/server/get-replies.test.ts
```

Expected: FAIL — `Cannot find module './get-replies'`

- [ ] **Step 3: Implement `get-replies.ts`**

Create `src/features/replies/server/get-replies.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { ReplyClassification } from '@prisma/client'
import type { ReplyWithLeadDTO } from '../types'

interface GetRepliesInput {
  organizationId: string
  classification?: ReplyClassification
  limit?: number
  offset?: number
}

export async function getReplies({
  organizationId,
  classification,
  limit = 50,
  offset = 0,
}: GetRepliesInput): Promise<{ replies: ReplyWithLeadDTO[]; total: number }> {
  const cappedLimit = Math.min(limit, 200)
  const where = {
    organizationId,
    ...(classification !== undefined && { classification }),
  }

  const [rows, total] = await Promise.all([
    prisma.inboundReply.findMany({
      where,
      include: { lead: { select: { email: true } } },
      orderBy: { receivedAt: 'desc' },
      take: cappedLimit,
      skip: offset,
    }),
    prisma.inboundReply.count({ where }),
  ])

  return {
    replies: rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      leadId: r.leadId,
      outboundMessageId: r.outboundMessageId,
      rawBody: r.rawBody,
      classification: r.classification,
      classificationConfidence: r.classificationConfidence,
      receivedAt: r.receivedAt,
      createdAt: r.createdAt,
      leadEmail: r.lead.email,
    })),
    total,
  }
}
```

- [ ] **Step 4: Run to confirm passing**

```bash
npx vitest run src/features/replies/server/get-replies.test.ts
```

Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/features/replies/server/get-replies.ts src/features/replies/server/get-replies.test.ts
git commit -m "feat: add getReplies server function"
```

---

## Task 3: `RepliesTable` component

**Files:**
- Create: `src/features/replies/components/replies-table.tsx`

- [ ] **Step 1: Create the component**

Create `src/features/replies/components/replies-table.tsx`:

```typescript
import { Badge } from '@/components/ui/badge'
import type { ReplyClassification } from '@prisma/client'
import type { ReplyWithLeadDTO } from '../types'

interface RepliesTableProps {
  replies: ReplyWithLeadDTO[]
}

const CLASSIFICATION_LABELS: Record<ReplyClassification, string> = {
  POSITIVE: 'Positive',
  NEUTRAL: 'Neutral',
  NEGATIVE: 'Negative',
  OUT_OF_OFFICE: 'Out of Office',
  UNSUBSCRIBE_REQUEST: 'Unsubscribe',
  REFERRAL: 'Referral',
  UNKNOWN: 'Unknown',
}

function ClassificationBadge({ value }: { value: ReplyClassification }) {
  const variantMap: Record<ReplyClassification, 'success' | 'muted' | 'danger' | 'warning' | 'default'> = {
    POSITIVE:            'success',
    NEUTRAL:             'muted',
    NEGATIVE:            'danger',
    OUT_OF_OFFICE:       'warning',
    UNSUBSCRIBE_REQUEST: 'danger',
    REFERRAL:            'default',
    UNKNOWN:             'muted',
  }
  return <Badge variant={variantMap[value]}>{CLASSIFICATION_LABELS[value]}</Badge>
}

export function RepliesTable({ replies }: RepliesTableProps) {
  if (replies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[#94a3b8] text-sm">No replies yet.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e2130]">
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Lead</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Classification</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Confidence</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Preview</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Received</th>
          </tr>
        </thead>
        <tbody>
          {replies.map((reply) => (
            <tr
              key={reply.id}
              className={
                reply.classification === 'POSITIVE'
                  ? 'border-b border-[#1a1d2e] bg-[#052e16]/20 hover:bg-[#052e16]/40 transition-colors'
                  : 'border-b border-[#1a1d2e] hover:bg-[#1a1d2e] transition-colors'
              }
            >
              <td className="py-3 px-4 text-[#e2e8f0]">{reply.leadEmail}</td>
              <td className="py-3 px-4">
                <ClassificationBadge value={reply.classification} />
              </td>
              <td className="py-3 px-4 text-[#94a3b8] text-xs">
                {reply.classificationConfidence !== null
                  ? `${Math.round(reply.classificationConfidence * 100)}%`
                  : '—'}
              </td>
              <td className="py-3 px-4 text-[#475569] text-xs hidden lg:table-cell max-w-xs truncate">
                {reply.rawBody.slice(0, 120)}
              </td>
              <td className="py-3 px-4 text-[#94a3b8] text-xs">
                {new Date(reply.receivedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/replies/components/replies-table.tsx
git commit -m "feat: add RepliesTable component"
```

---

## Task 4: `RepliesClient` — filter state wrapper

**Files:**
- Create: `src/app/(dashboard)/replies/replies-client.tsx`

- [ ] **Step 1: Create the client component**

Create `src/app/(dashboard)/replies/replies-client.tsx`:

```typescript
'use client'

import { useState } from 'react'
import type { ReplyClassification } from '@prisma/client'
import { RepliesTable } from '@/features/replies/components/replies-table'
import type { ReplyWithLeadDTO } from '@/features/replies/types'

const ALL_CLASSIFICATIONS: ReplyClassification[] = [
  'POSITIVE',
  'NEUTRAL',
  'NEGATIVE',
  'OUT_OF_OFFICE',
  'UNSUBSCRIBE_REQUEST',
  'REFERRAL',
  'UNKNOWN',
]

const CLASSIFICATION_LABELS: Record<ReplyClassification, string> = {
  POSITIVE:            'Positive',
  NEUTRAL:             'Neutral',
  NEGATIVE:            'Negative',
  OUT_OF_OFFICE:       'Out of Office',
  UNSUBSCRIBE_REQUEST: 'Unsubscribe',
  REFERRAL:            'Referral',
  UNKNOWN:             'Unknown',
}

interface RepliesClientProps {
  initialReplies: ReplyWithLeadDTO[]
  initialTotal: number
}

export function RepliesClient({ initialReplies, initialTotal }: RepliesClientProps) {
  const [filter, setFilter] = useState<ReplyClassification | 'ALL'>('ALL')

  const filtered =
    filter === 'ALL'
      ? initialReplies
      : initialReplies.filter((r) => r.classification === filter)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-[#94a3b8] text-sm">
          {initialTotal.toLocaleString()} repl{initialTotal !== 1 ? 'ies' : 'y'}
        </span>

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ReplyClassification | 'ALL')}
          className="bg-[#1a1d2e] border border-[#2a2d3e] text-[#e2e8f0] text-xs rounded px-3 py-1.5 focus:outline-none focus:border-[#6366f1]"
        >
          <option value="ALL">All Classifications</option>
          {ALL_CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {CLASSIFICATION_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
        <RepliesTable replies={filtered} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/replies/replies-client.tsx
git commit -m "feat: add RepliesClient with classification filter"
```

---

## Task 5: `/replies` page (server component)

**Files:**
- Create: `src/app/(dashboard)/replies/page.tsx`

- [ ] **Step 1: Create the page**

Create `src/app/(dashboard)/replies/page.tsx`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { RepliesClient } from './replies-client'
import { getReplies } from '@/features/replies/server/get-replies'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function RepliesPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const { replies, total } = await getReplies({ organizationId: org.id })

  return (
    <>
      <Header title="Replies" />
      <div className="flex-1 p-6">
        <RepliesClient initialReplies={replies} initialTotal={total} />
      </div>
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/(dashboard)/replies/page.tsx
git commit -m "feat: add /replies page"
```

---

## Task 6: Add Replies to sidebar

**Files:**
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Update the sidebar**

Replace the contents of `src/components/layout/sidebar.tsx` with:

```typescript
'use client'

import {
  LayoutDashboard,
  Users,
  Megaphone,
  GitBranch,
  Inbox,
  BarChart2,
  FileText,
  Settings,
  Mail,
  MessageSquare,
} from 'lucide-react'
import { NavItem } from './nav-item'

const NAV_ITEMS = [
  { href: '/dashboard',  icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/leads',      icon: Users,           label: 'Leads' },
  { href: '/drafts',     icon: Mail,            label: 'Drafts' },
  { href: '/campaigns',  icon: Megaphone,       label: 'Campaigns' },
  { href: '/sequences',  icon: GitBranch,       label: 'Sequences' },
  { href: '/inbox',      icon: Inbox,           label: 'Inbox' },
  { href: '/replies',    icon: MessageSquare,   label: 'Replies' },
  { href: '/analytics',  icon: BarChart2,       label: 'Analytics' },
  { href: '/templates',  icon: FileText,        label: 'Templates' },
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

- [ ] **Step 2: Run full test suite**

```bash
npx vitest run
```

Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/sidebar.tsx
git commit -m "feat: add Replies nav item to sidebar"
```

---

## Acceptance Criteria

- [ ] `/replies` renders for an authenticated org member
- [ ] Table shows: lead email, classification badge, confidence %, truncated rawBody preview (hidden on small screens), receivedAt date
- [ ] Default sort is newest-first (`receivedAt DESC`)
- [ ] POSITIVE rows have a subtle green background tint
- [ ] UNSUBSCRIBE_REQUEST shows a `danger` badge; OUT_OF_OFFICE shows a `warning` badge
- [ ] Classification dropdown filters rows without a page reload
- [ ] "All Classifications" resets the filter
- [ ] Empty state shows "No replies yet."
- [ ] Sidebar shows a Replies icon that highlights when active
- [ ] All existing tests pass (`npx vitest run`)

---

## Copy-Paste Coding Prompts

### Prompt 1 — Add `ReplyWithLeadDTO` (Task 1)

```
In src/features/replies/types.ts, add the following interface after InboundReplyDTO:

  export interface ReplyWithLeadDTO extends InboundReplyDTO {
    leadEmail: string
  }

Do not change anything else in the file.
```

### Prompt 2 — Implement `getReplies` (Task 2)

```
Using TDD, implement src/features/replies/server/get-replies.ts and its test.

The test file is src/features/replies/server/get-replies.test.ts. Follow the same
vi.mock-at-top pattern as src/features/replies/server/ingest-reply.test.ts.

Function signature:
  getReplies({ organizationId, classification?, limit?, offset? })
    => Promise<{ replies: ReplyWithLeadDTO[]; total: number }>

Requirements:
- Cap limit at 200
- Build a `where` object: always include organizationId; spread in `classification`
  only when it is not undefined
- Run prisma.inboundReply.findMany (include lead.select email, orderBy receivedAt desc)
  and prisma.inboundReply.count in parallel with Promise.all
- Map each row to ReplyWithLeadDTO by flattening r.lead.email to leadEmail

Tests to cover:
1. Returns replies with leadEmail extracted from lead join, total is correct
2. Queries with where: { organizationId } and orderBy: { receivedAt: 'desc' },
   include: { lead: { select: { email: true } } }
3. Adds classification to where when provided; count query uses same where
4. Caps limit at 200 (pass limit: 500, expect take: 200)
5. Passes offset through as skip
```

### Prompt 3 — Build `RepliesTable` (Task 3)

```
Create src/features/replies/components/replies-table.tsx.

Props: { replies: ReplyWithLeadDTO[] }

Columns: Lead (email), Classification (badge), Confidence (% or em-dash),
Preview (reply.rawBody.slice(0, 120), hidden on small screens), Received (short date).

Badge variant map using src/components/ui/badge.tsx:
  POSITIVE → success
  NEUTRAL → muted
  NEGATIVE → danger
  OUT_OF_OFFICE → warning
  UNSUBSCRIBE_REQUEST → danger
  REFERRAL → default
  UNKNOWN → muted

Row background:
  POSITIVE: "bg-[#052e16]/20 hover:bg-[#052e16]/40"
  all others: "hover:bg-[#1a1d2e]"

All rows get "border-b border-[#1a1d2e] transition-colors".

Empty state: centered <p className="text-[#94a3b8] text-sm">No replies yet.</p>

Match the dark theme from src/features/drafts/components/drafts-table.tsx.
```

### Prompt 4 — Build `RepliesClient` (Task 4)

```
Create src/app/(dashboard)/replies/replies-client.tsx as a 'use client' component.

Props: { initialReplies: ReplyWithLeadDTO[], initialTotal: number }

State: filter (ReplyClassification | 'ALL'), default 'ALL'

Toolbar row:
  left: "{initialTotal} repl{ies|y}" in text-[#94a3b8] text-sm
  right: <select> with option value "ALL" ("All Classifications") plus one
         option per ReplyClassification with a human-readable label

Filtering: in-component array filter, no fetch.

Table: wrap <RepliesTable replies={filtered} /> in
  <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">

Match the overall spacing of src/app/(dashboard)/drafts/drafts-client.tsx.
```

### Prompt 5 — Create `/replies` page (Task 5)

```
Create src/app/(dashboard)/replies/page.tsx as an async server component.

Follow src/app/(dashboard)/leads/page.tsx exactly:
1. auth() — redirect to /dashboard if no orgId
2. resolveOrganization(orgId)
3. getReplies({ organizationId: org.id })
4. Return <Header title="Replies" /> and
   <div className="flex-1 p-6"><RepliesClient initialReplies={replies} initialTotal={total} /></div>
```

### Prompt 6 — Add Replies to sidebar (Task 6)

```
In src/components/layout/sidebar.tsx:
1. Add MessageSquare to the lucide-react import
2. Add { href: '/replies', icon: MessageSquare, label: 'Replies' } to NAV_ITEMS
   between the Inbox and Analytics entries

Do not change anything else.
```
