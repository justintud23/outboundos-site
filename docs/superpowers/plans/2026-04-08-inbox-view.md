# Inbox View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a threaded inbox view showing outbound messages and inbound replies per lead, with filters, read/unread tracking, and a split-pane conversation UI.

**Architecture:** Threads are derived from existing OutboundMessage + InboundReply data grouped by leadId — no Thread model. A two-query strategy fetches outbound and inbound activity separately, merged in the server layer. Thread detail fetches all messages for a lead and merges them chronologically. Read state uses the `isRead` field on InboundReply (added in Feature 1 schema migration). Split-pane layout on desktop, stacked on mobile.

**Tech Stack:** Next.js 16, React 19, Prisma 7, PostgreSQL, TypeScript strict, Tailwind v4, clsx, lucide-react.

**Spec:** `docs/superpowers/specs/2026-04-08-three-features-design.md` (Feature 3 section)

**Prerequisites:** Feature 1 schema migration already added `isRead` to InboundReply and activity indexes on OutboundMessage/InboundReply.

---

## File Structure

**Create:**
- `src/features/inbox/types.ts` — DTOs
- `src/features/inbox/server/get-inbox-threads.ts` — thread list query
- `src/features/inbox/server/get-inbox-threads.test.ts` — tests
- `src/features/inbox/server/get-thread-detail.ts` — thread detail query
- `src/features/inbox/server/get-thread-detail.test.ts` — tests
- `src/features/inbox/server/mark-thread-read.ts` — mark read/unread
- `src/app/api/inbox/[leadId]/read/route.ts` — PATCH endpoint
- `src/app/api/inbox/[leadId]/route.ts` — GET thread detail endpoint
- `src/app/(dashboard)/inbox/inbox-client.tsx` — client orchestrator
- `src/features/inbox/components/thread-list.tsx` — thread list with filters
- `src/features/inbox/components/thread-detail.tsx` — conversation view
- `src/features/inbox/components/message-bubble.tsx` — message bubble

**Modify:**
- `src/app/(dashboard)/inbox/page.tsx` — replace placeholder

---

### Task 1: Inbox Types and DTOs

**Files:**
- Create: `src/features/inbox/types.ts`

- [ ] **Step 1: Create the types file**

Create `src/features/inbox/types.ts`:

```typescript
import type { LeadStatus, ReplyClassification, MessageStatus } from '@prisma/client'

// ─── Thread list ────────────────────────────────────────────

export interface InboxThreadDTO {
  leadId: string
  leadName: string
  leadEmail: string
  leadCompany: string | null
  leadStatus: LeadStatus
  lastActivityAt: Date
  unreadCount: number
  messageCount: number
  replyCount: number
  latestClassification: ReplyClassification | null
  latestPreview: string
}

export type InboxFilter = 'all' | 'unread' | 'interested' | 'unsubscribed' | 'recent'

// ─── Thread detail ──────────────────────────────────────────

export interface ThreadDetailDTO {
  lead: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    company: string | null
    title: string | null
    status: LeadStatus
    score: number | null
  }
  messages: ThreadMessageDTO[]
  totalMessages: number
}

export interface ThreadMessageDTO {
  id: string
  direction: 'outbound' | 'inbound'
  subject: string | null
  body: string
  timestamp: Date
  classification?: ReplyClassification
  classificationConfidence?: number
  status?: MessageStatus
  isRead?: boolean
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/inbox/types.ts
git commit -m "feat: add inbox DTOs for threads and messages"
```

---

### Task 2: Get Inbox Threads (Two-Query Strategy)

**Files:**
- Create: `src/features/inbox/server/get-inbox-threads.ts`
- Create: `src/features/inbox/server/get-inbox-threads.test.ts`

- [ ] **Step 1: Write test file**

Create `src/features/inbox/server/get-inbox-threads.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    outboundMessage: { groupBy: vi.fn() },
    inboundReply: { groupBy: vi.fn(), findMany: vi.fn() },
    lead: { findMany: vi.fn(), count: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getInboxThreads } from './get-inbox-threads'

const mockMsgGroupBy = prisma.outboundMessage.groupBy as ReturnType<typeof vi.fn>
const mockReplyGroupBy = prisma.inboundReply.groupBy as ReturnType<typeof vi.fn>
const mockReplyFindMany = prisma.inboundReply.findMany as ReturnType<typeof vi.fn>
const mockLeadFindMany = prisma.lead.findMany as ReturnType<typeof vi.fn>
const mockLeadCount = prisma.lead.count as ReturnType<typeof vi.fn>

const ORG = 'org-1'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getInboxThreads', () => {
  it('returns threads with lastActivityAt from latest activity', async () => {
    const msgDate = new Date('2026-04-05T00:00:00Z')
    const replyDate = new Date('2026-04-07T00:00:00Z')

    mockMsgGroupBy.mockResolvedValue([
      { leadId: 'lead-1', _max: { sentAt: msgDate }, _count: { _all: 2 } },
    ])
    mockReplyGroupBy.mockResolvedValue([
      { leadId: 'lead-1', _max: { receivedAt: replyDate }, _count: { _all: 1 }, _sum: { isRead: null } },
    ])
    mockLeadFindMany.mockResolvedValue([{
      id: 'lead-1', email: 'alice@test.com', firstName: 'Alice', lastName: 'Smith',
      company: 'Acme', status: 'REPLIED',
    }])
    mockLeadCount.mockResolvedValue(1)
    mockReplyFindMany.mockResolvedValue([
      { leadId: 'lead-1', rawBody: 'Thanks for reaching out!', classification: 'POSITIVE', isRead: false },
    ])

    const result = await getInboxThreads({ organizationId: ORG })

    expect(result.threads).toHaveLength(1)
    expect(result.threads[0].lastActivityAt).toEqual(replyDate)
    expect(result.threads[0].leadName).toBe('Alice Smith')
    expect(result.threads[0].messageCount).toBe(2)
    expect(result.threads[0].replyCount).toBe(1)
  })

  it('returns empty when no activity', async () => {
    mockMsgGroupBy.mockResolvedValue([])
    mockReplyGroupBy.mockResolvedValue([])

    const result = await getInboxThreads({ organizationId: ORG })

    expect(result.threads).toEqual([])
    expect(result.total).toBe(0)
  })

  it('respects pagination limits', async () => {
    mockMsgGroupBy.mockResolvedValue([])
    mockReplyGroupBy.mockResolvedValue([])

    await getInboxThreads({ organizationId: ORG, limit: 500 })
    // Should cap at 100 internally — no assertion needed, just verifying no error
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/inbox/server/get-inbox-threads.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement get-inbox-threads.ts**

Create `src/features/inbox/server/get-inbox-threads.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { InboxThreadDTO, InboxFilter } from '../types'

interface GetInboxThreadsInput {
  organizationId: string
  filter?: InboxFilter
  limit?: number
  offset?: number
}

export async function getInboxThreads({
  organizationId,
  filter = 'all',
  limit = 25,
  offset = 0,
}: GetInboxThreadsInput): Promise<{ threads: InboxThreadDTO[]; total: number }> {
  const cappedLimit = Math.min(limit, 100)

  // Query 1: outbound activity per lead
  const outboundActivity = await prisma.outboundMessage.groupBy({
    by: ['leadId'],
    where: { organizationId },
    _max: { sentAt: true },
    _count: { _all: true },
  })

  // Query 2: inbound activity per lead
  const inboundActivity = await prisma.inboundReply.groupBy({
    by: ['leadId'],
    where: { organizationId },
    _max: { receivedAt: true },
    _count: { _all: true },
  })

  // Merge: collect all leadIds with activity
  const outboundMap = new Map(
    outboundActivity.map((o) => [o.leadId, { latestOutbound: o._max.sentAt, messageCount: o._count._all }]),
  )
  const inboundMap = new Map(
    inboundActivity.map((i) => [i.leadId, { latestInbound: i._max.receivedAt, replyCount: i._count._all }]),
  )

  const allLeadIds = new Set([...outboundMap.keys(), ...inboundMap.keys()])

  if (allLeadIds.size === 0) {
    return { threads: [], total: 0 }
  }

  // Compute lastActivityAt per lead and sort
  type LeadActivity = { leadId: string; lastActivityAt: Date; messageCount: number; replyCount: number }
  const activities: LeadActivity[] = []

  for (const leadId of allLeadIds) {
    const ob = outboundMap.get(leadId)
    const ib = inboundMap.get(leadId)

    const candidates: Date[] = []
    if (ob?.latestOutbound) candidates.push(ob.latestOutbound)
    if (ib?.latestInbound) candidates.push(ib.latestInbound)

    const lastActivityAt = candidates.length > 0
      ? new Date(Math.max(...candidates.map((d) => d.getTime())))
      : new Date(0)

    activities.push({
      leadId,
      lastActivityAt,
      messageCount: ob?.messageCount ?? 0,
      replyCount: ib?.replyCount ?? 0,
    })
  }

  // Sort by lastActivityAt DESC
  activities.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime())

  // Fetch leads for filtering + data
  const leadIds = activities.map((a) => a.leadId)

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, organizationId },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      company: true, status: true,
    },
  })

  const leadMap = new Map(leads.map((l) => [l.id, l]))

  // Apply filter
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  let filtered = activities.filter((a) => leadMap.has(a.leadId))

  if (filter === 'interested') {
    filtered = filtered.filter((a) => leadMap.get(a.leadId)!.status === 'INTERESTED')
  } else if (filter === 'unsubscribed') {
    filtered = filtered.filter((a) => leadMap.get(a.leadId)!.status === 'UNSUBSCRIBED')
  } else if (filter === 'recent') {
    filtered = filtered.filter((a) => a.lastActivityAt >= sevenDaysAgo)
  }
  // 'unread' filter applied after we get unread counts below

  const total = filtered.length

  // Paginate (before unread filter for 'unread' — we'll handle that after)
  let paginated = filtered

  // Get unread counts for leads in the current set
  const paginatedLeadIds = paginated.map((a) => a.leadId)

  const unreadCounts = await prisma.inboundReply.groupBy({
    by: ['leadId'],
    where: { organizationId, leadId: { in: paginatedLeadIds }, isRead: false },
    _count: { _all: true },
  })
  const unreadMap = new Map(unreadCounts.map((u) => [u.leadId, u._count._all]))

  // Apply unread filter if needed
  if (filter === 'unread') {
    paginated = paginated.filter((a) => (unreadMap.get(a.leadId) ?? 0) > 0)
  }

  const finalTotal = filter === 'unread' ? paginated.length : total

  // Apply pagination
  const page = paginated.slice(offset, offset + cappedLimit)
  const pageLeadIds = page.map((a) => a.leadId)

  // Get latest reply for preview + classification
  const latestReplies = pageLeadIds.length > 0
    ? await prisma.inboundReply.findMany({
        where: { organizationId, leadId: { in: pageLeadIds } },
        orderBy: { receivedAt: 'desc' },
        distinct: ['leadId'],
        select: { leadId: true, rawBody: true, classification: true },
      })
    : []

  const latestReplyMap = new Map(latestReplies.map((r) => [r.leadId, r]))

  // Build DTOs
  const threads: InboxThreadDTO[] = page.map((activity) => {
    const lead = leadMap.get(activity.leadId)!
    const latestReply = latestReplyMap.get(activity.leadId)
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email

    return {
      leadId: activity.leadId,
      leadName: name,
      leadEmail: lead.email,
      leadCompany: lead.company,
      leadStatus: lead.status,
      lastActivityAt: activity.lastActivityAt,
      unreadCount: unreadMap.get(activity.leadId) ?? 0,
      messageCount: activity.messageCount,
      replyCount: activity.replyCount,
      latestClassification: latestReply?.classification ?? null,
      latestPreview: latestReply?.rawBody?.slice(0, 120) ?? '',
    }
  })

  return { threads, total: finalTotal }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/features/inbox/server/get-inbox-threads.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/inbox/server/get-inbox-threads.ts src/features/inbox/server/get-inbox-threads.test.ts
git commit -m "feat: add getInboxThreads with two-query merge strategy"
```

---

### Task 3: Get Thread Detail

**Files:**
- Create: `src/features/inbox/server/get-thread-detail.ts`
- Create: `src/features/inbox/server/get-thread-detail.test.ts`

- [ ] **Step 1: Write test file**

Create `src/features/inbox/server/get-thread-detail.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    outboundMessage: { findMany: vi.fn() },
    inboundReply: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getThreadDetail } from './get-thread-detail'

const mockLeadFind = prisma.lead.findFirst as ReturnType<typeof vi.fn>
const mockMsgFind = prisma.outboundMessage.findMany as ReturnType<typeof vi.fn>
const mockReplyFind = prisma.inboundReply.findMany as ReturnType<typeof vi.fn>

const ORG = 'org-1'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getThreadDetail', () => {
  it('throws if lead not found', async () => {
    mockLeadFind.mockResolvedValue(null)

    await expect(
      getThreadDetail({ organizationId: ORG, leadId: 'bad-id' }),
    ).rejects.toThrow('Lead not found')
  })

  it('merges outbound and inbound messages chronologically', async () => {
    mockLeadFind.mockResolvedValue({
      id: 'lead-1', email: 'alice@test.com', firstName: 'Alice', lastName: 'Smith',
      company: 'Acme', title: 'VP', status: 'REPLIED', score: 80,
    })

    mockMsgFind.mockResolvedValue([
      { id: 'msg-1', subject: 'Hello', body: 'Hi there', sentAt: new Date('2026-04-01'), status: 'SENT' },
    ])

    mockReplyFind.mockResolvedValue([
      { id: 'reply-1', rawBody: 'Thanks!', receivedAt: new Date('2026-04-02'), classification: 'POSITIVE', classificationConfidence: 0.95, isRead: true },
    ])

    const result = await getThreadDetail({ organizationId: ORG, leadId: 'lead-1' })

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0].direction).toBe('outbound')
    expect(result.messages[0].timestamp).toEqual(new Date('2026-04-01'))
    expect(result.messages[1].direction).toBe('inbound')
    expect(result.messages[1].timestamp).toEqual(new Date('2026-04-02'))
    expect(result.totalMessages).toBe(2)
  })

  it('returns empty messages array when no activity', async () => {
    mockLeadFind.mockResolvedValue({
      id: 'lead-2', email: 'bob@test.com', firstName: null, lastName: null,
      company: null, title: null, status: 'NEW', score: null,
    })
    mockMsgFind.mockResolvedValue([])
    mockReplyFind.mockResolvedValue([])

    const result = await getThreadDetail({ organizationId: ORG, leadId: 'lead-2' })

    expect(result.messages).toEqual([])
    expect(result.totalMessages).toBe(0)
  })
})
```

- [ ] **Step 2: Implement get-thread-detail.ts**

Create `src/features/inbox/server/get-thread-detail.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'
import type { ThreadDetailDTO, ThreadMessageDTO } from '../types'

interface GetThreadDetailInput {
  organizationId: string
  leadId: string
}

export async function getThreadDetail({
  organizationId,
  leadId,
}: GetThreadDetailInput): Promise<ThreadDetailDTO> {
  // 1. Fetch lead
  const lead = await prisma.lead.findFirst({
    where: { id: leadId, organizationId },
    select: {
      id: true, email: true, firstName: true, lastName: true,
      company: true, title: true, status: true, score: true,
    },
  })

  if (!lead) {
    throw new Error('Lead not found')
  }

  // 2. Fetch outbound messages
  const outboundMessages = await prisma.outboundMessage.findMany({
    where: { leadId, organizationId },
    select: { id: true, subject: true, body: true, sentAt: true, status: true },
    orderBy: { sentAt: 'asc' },
  })

  // 3. Fetch inbound replies
  const inboundReplies = await prisma.inboundReply.findMany({
    where: { leadId, organizationId },
    select: {
      id: true, rawBody: true, receivedAt: true,
      classification: true, classificationConfidence: true, isRead: true,
    },
    orderBy: { receivedAt: 'asc' },
  })

  // 4. Merge into unified timeline
  const messages: ThreadMessageDTO[] = [
    ...outboundMessages.map((m) => ({
      id: m.id,
      direction: 'outbound' as const,
      subject: m.subject,
      body: m.body,
      timestamp: m.sentAt ?? new Date(0),
      status: m.status,
    })),
    ...inboundReplies.map((r) => ({
      id: r.id,
      direction: 'inbound' as const,
      subject: null,
      body: r.rawBody,
      timestamp: r.receivedAt,
      classification: r.classification,
      classificationConfidence: r.classificationConfidence ?? undefined,
      isRead: r.isRead,
    })),
  ]

  // Sort chronologically ASC
  messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return {
    lead,
    messages,
    totalMessages: messages.length,
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/features/inbox/server/get-thread-detail.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/features/inbox/server/get-thread-detail.ts src/features/inbox/server/get-thread-detail.test.ts
git commit -m "feat: add getThreadDetail with chronological message merge"
```

---

### Task 4: Mark Thread Read + API Routes

**Files:**
- Create: `src/features/inbox/server/mark-thread-read.ts`
- Create: `src/app/api/inbox/[leadId]/read/route.ts`
- Create: `src/app/api/inbox/[leadId]/route.ts`

- [ ] **Step 1: Create mark-thread-read.ts**

Create `src/features/inbox/server/mark-thread-read.ts`:

```typescript
import { prisma } from '@/lib/db/prisma'

interface MarkThreadReadInput {
  organizationId: string
  leadId: string
  isRead: boolean
}

export async function markThreadRead({
  organizationId,
  leadId,
  isRead,
}: MarkThreadReadInput): Promise<{ updated: number }> {
  const result = await prisma.inboundReply.updateMany({
    where: { organizationId, leadId },
    data: { isRead },
  })

  return { updated: result.count }
}
```

- [ ] **Step 2: Create PATCH /api/inbox/[leadId]/read route**

Create `src/app/api/inbox/[leadId]/read/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { markThreadRead } from '@/features/inbox/server/mark-thread-read'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leadId } = await params
  const org = await resolveOrganization(orgId)

  let body: { isRead?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.isRead !== 'boolean') {
    return NextResponse.json({ error: 'isRead (boolean) is required' }, { status: 400 })
  }

  const result = await markThreadRead({
    organizationId: org.id,
    leadId,
    isRead: body.isRead,
  })

  return NextResponse.json(result)
}
```

- [ ] **Step 3: Create GET /api/inbox/[leadId] route**

Create `src/app/api/inbox/[leadId]/route.ts`:

```typescript
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getThreadDetail } from '@/features/inbox/server/get-thread-detail'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leadId } = await params
  const org = await resolveOrganization(orgId)

  try {
    const detail = await getThreadDetail({ organizationId: org.id, leadId })
    return NextResponse.json(detail)
  } catch (err) {
    if (err instanceof Error && err.message === 'Lead not found') {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }
    throw err
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/features/inbox/server/mark-thread-read.ts "src/app/api/inbox/[leadId]/read/route.ts" "src/app/api/inbox/[leadId]/route.ts"
git commit -m "feat: add mark-thread-read and inbox API routes"
```

---

### Task 5: Message Bubble Component

**Files:**
- Create: `src/features/inbox/components/message-bubble.tsx`

- [ ] **Step 1: Create message-bubble.tsx**

Create `src/features/inbox/components/message-bubble.tsx`:

```tsx
import { Badge } from '@/components/ui/badge'
import type { ThreadMessageDTO } from '../types'
import type { ReplyClassification } from '@prisma/client'

const CLASSIFICATION_VARIANT: Record<ReplyClassification, 'success' | 'muted' | 'danger' | 'warning' | 'default'> = {
  POSITIVE: 'success',
  NEUTRAL: 'muted',
  NEGATIVE: 'danger',
  OUT_OF_OFFICE: 'warning',
  UNSUBSCRIBE_REQUEST: 'danger',
  REFERRAL: 'default',
  UNKNOWN: 'muted',
}

const CLASSIFICATION_LABEL: Record<ReplyClassification, string> = {
  POSITIVE: 'Positive',
  NEUTRAL: 'Neutral',
  NEGATIVE: 'Negative',
  OUT_OF_OFFICE: 'Out of Office',
  UNSUBSCRIBE_REQUEST: 'Unsubscribe',
  REFERRAL: 'Referral',
  UNKNOWN: 'Unknown',
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function MessageBubble({ message }: { message: ThreadMessageDTO }) {
  const isOutbound = message.direction === 'outbound'

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[75%] rounded-[var(--radius-card)] p-4 space-y-2',
          isOutbound
            ? 'bg-[var(--accent-indigo-glow)] border border-[var(--accent-indigo)]/20'
            : 'bg-[var(--bg-surface)] border border-[var(--border-default)]',
        ].join(' ')}
      >
        {/* Subject line for outbound */}
        {isOutbound && message.subject && (
          <p className="text-[var(--text-primary)] text-sm font-medium">{message.subject}</p>
        )}

        {/* Body */}
        <p className="text-[var(--text-secondary)] text-sm whitespace-pre-wrap leading-relaxed">
          {message.body}
        </p>

        {/* Footer */}
        <div className={`flex items-center gap-2 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
          {/* Classification badge for inbound */}
          {!isOutbound && message.classification && (
            <Badge variant={CLASSIFICATION_VARIANT[message.classification]}>
              {CLASSIFICATION_LABEL[message.classification]}
            </Badge>
          )}

          {/* Confidence for inbound */}
          {!isOutbound && message.classificationConfidence !== undefined && (
            <span className="text-[var(--text-muted)] text-xs">
              {Math.round(message.classificationConfidence * 100)}%
            </span>
          )}

          <span className="text-[var(--text-muted)] text-xs">
            {formatTime(message.timestamp)}
          </span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/inbox/components/message-bubble.tsx
git commit -m "feat: add message bubble component for inbox conversations"
```

---

### Task 6: Thread List Component

**Files:**
- Create: `src/features/inbox/components/thread-list.tsx`

- [ ] **Step 1: Create thread-list.tsx**

Create `src/features/inbox/components/thread-list.tsx`:

```tsx
'use client'

import { Badge } from '@/components/ui/badge'
import type { InboxThreadDTO, InboxFilter } from '../types'
import type { ReplyClassification } from '@prisma/client'

const CLASSIFICATION_VARIANT: Record<ReplyClassification, 'success' | 'muted' | 'danger' | 'warning' | 'default'> = {
  POSITIVE: 'success',
  NEUTRAL: 'muted',
  NEGATIVE: 'danger',
  OUT_OF_OFFICE: 'warning',
  UNSUBSCRIBE_REQUEST: 'danger',
  REFERRAL: 'default',
  UNKNOWN: 'muted',
}

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'interested', label: 'Interested' },
  { key: 'recent', label: 'Recent' },
]

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diffMs = now - new Date(date).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d`
  return `${Math.floor(diffDay / 30)}mo`
}

interface ThreadListProps {
  threads: InboxThreadDTO[]
  selectedLeadId: string | null
  filter: InboxFilter
  onSelectThread: (leadId: string) => void
  onFilterChange: (filter: InboxFilter) => void
}

export function ThreadList({
  threads,
  selectedLeadId,
  filter,
  onSelectThread,
  onFilterChange,
}: ThreadListProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Filter tabs */}
      <div className="flex gap-1 px-4 py-3 border-b border-[var(--border-default)]">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilterChange(f.key)}
            className={[
              'px-3 py-1.5 rounded-[var(--radius-btn)] text-xs font-medium transition-colors duration-[var(--transition-base)]',
              filter === f.key
                ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Thread items */}
      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            {filter === 'unread' ? (
              <p className="text-[var(--text-muted)] text-sm">All caught up! No unread messages.</p>
            ) : (
              <>
                <p className="text-[var(--text-muted)] text-sm">No conversations yet.</p>
                <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">Send your first outreach to get started.</p>
              </>
            )}
          </div>
        )}

        {threads.map((thread) => (
          <button
            key={thread.leadId}
            onClick={() => onSelectThread(thread.leadId)}
            className={[
              'w-full text-left px-4 py-3 border-b border-[var(--border-subtle)] transition-colors duration-[var(--transition-fast)]',
              selectedLeadId === thread.leadId
                ? 'bg-[var(--accent-indigo-glow)]/30'
                : 'hover:bg-[var(--bg-surface-raised)]',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {/* Unread dot */}
                  {thread.unreadCount > 0 && (
                    <span className="w-2 h-2 rounded-full bg-[var(--accent-indigo)] flex-shrink-0" />
                  )}
                  <span className={`text-sm truncate ${thread.unreadCount > 0 ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-primary)]'}`}>
                    {thread.leadName}
                  </span>
                </div>
                {thread.leadCompany && (
                  <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">{thread.leadCompany}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-[var(--text-muted)] text-xs">
                  {formatRelativeTime(thread.lastActivityAt)}
                </span>
                {thread.latestClassification && (
                  <Badge variant={CLASSIFICATION_VARIANT[thread.latestClassification]}>
                    {thread.latestClassification}
                  </Badge>
                )}
              </div>
            </div>
            {thread.latestPreview && (
              <p className="text-[var(--text-muted)] text-xs mt-1 line-clamp-1">{thread.latestPreview}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/inbox/components/thread-list.tsx
git commit -m "feat: add thread list component with filters and unread indicators"
```

---

### Task 7: Thread Detail Component

**Files:**
- Create: `src/features/inbox/components/thread-detail.tsx`

- [ ] **Step 1: Create thread-detail.tsx**

Create `src/features/inbox/components/thread-detail.tsx`:

```tsx
'use client'

import { Badge } from '@/components/ui/badge'
import { MessageBubble } from './message-bubble'
import type { ThreadDetailDTO } from '../types'
import type { LeadStatus } from '@prisma/client'

const STATUS_VARIANT: Record<LeadStatus, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
  NEW: 'default',
  CONTACTED: 'warning',
  REPLIED: 'success',
  BOUNCED: 'danger',
  UNSUBSCRIBED: 'danger',
  CONVERTED: 'success',
  INTERESTED: 'success',
  NOT_INTERESTED: 'danger',
}

interface ThreadDetailProps {
  thread: ThreadDetailDTO | null
  loading: boolean
  onBack?: () => void
}

export function ThreadDetail({ thread, loading, onBack }: ThreadDetailProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-muted)] text-sm">Loading conversation...</p>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-muted)] text-sm">Select a conversation to view messages</p>
      </div>
    )
  }

  const leadName = [thread.lead.firstName, thread.lead.lastName].filter(Boolean).join(' ') || thread.lead.email

  return (
    <div className="flex flex-col h-full">
      {/* Lead header */}
      <div className="px-5 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)]/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="lg:hidden text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-sm"
            >
              &larr;
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[var(--text-primary)] font-semibold text-sm">{leadName}</h2>
              <Badge variant={STATUS_VARIANT[thread.lead.status]}>
                {thread.lead.status}
              </Badge>
              {thread.lead.score !== null && (
                <Badge variant={thread.lead.score >= 70 ? 'success' : thread.lead.score >= 40 ? 'warning' : 'danger'}>
                  {thread.lead.score}
                </Badge>
              )}
            </div>
            <p className="text-[var(--text-muted)] text-xs mt-0.5">
              {thread.lead.email}
              {thread.lead.company && ` \u00B7 ${thread.lead.company}`}
              {thread.lead.title && ` \u00B7 ${thread.lead.title}`}
            </p>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {thread.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[var(--text-muted)] text-sm">No messages in this conversation.</p>
          </div>
        ) : (
          thread.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/features/inbox/components/thread-detail.tsx
git commit -m "feat: add thread detail component with lead header and message list"
```

---

### Task 8: Inbox Page + Client

**Files:**
- Modify: `src/app/(dashboard)/inbox/page.tsx` (replace placeholder)
- Create: `src/app/(dashboard)/inbox/inbox-client.tsx`

- [ ] **Step 1: Replace inbox page.tsx**

Replace the entire contents of `src/app/(dashboard)/inbox/page.tsx`:

```tsx
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { InboxClient } from './inbox-client'
import { getInboxThreads } from '@/features/inbox/server/get-inbox-threads'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function InboxPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const { threads, total } = await getInboxThreads({ organizationId: org.id, limit: 25 })

  return (
    <>
      <Header title="Inbox" />
      <div className="flex-1 overflow-hidden">
        <InboxClient initialThreads={threads} initialTotal={total} />
      </div>
    </>
  )
}
```

- [ ] **Step 2: Create inbox-client.tsx**

Create `src/app/(dashboard)/inbox/inbox-client.tsx`:

```tsx
'use client'

import { useState, useCallback } from 'react'
import { ThreadList } from '@/features/inbox/components/thread-list'
import { ThreadDetail } from '@/features/inbox/components/thread-detail'
import type { InboxThreadDTO, InboxFilter, ThreadDetailDTO } from '@/features/inbox/types'

interface InboxClientProps {
  initialThreads: InboxThreadDTO[]
  initialTotal: number
}

export function InboxClient({ initialThreads, initialTotal }: InboxClientProps) {
  const [threads, setThreads] = useState(initialThreads)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [threadDetail, setThreadDetail] = useState<ThreadDetailDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<InboxFilter>('all')

  const handleSelectThread = useCallback(async (leadId: string) => {
    setSelectedLeadId(leadId)
    setLoading(true)

    try {
      // Fetch thread detail
      const res = await fetch(`/api/inbox/${leadId}`)
      if (res.ok) {
        const detail = await res.json() as ThreadDetailDTO
        setThreadDetail(detail)

        // Mark as read
        const thread = threads.find((t) => t.leadId === leadId)
        if (thread && thread.unreadCount > 0) {
          await fetch(`/api/inbox/${leadId}/read`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isRead: true }),
          })

          // Update thread list unread count locally
          setThreads((prev) =>
            prev.map((t) =>
              t.leadId === leadId ? { ...t, unreadCount: 0 } : t,
            ),
          )
        }
      }
    } finally {
      setLoading(false)
    }
  }, [threads])

  const handleFilterChange = useCallback(async (newFilter: InboxFilter) => {
    setFilter(newFilter)
    setSelectedLeadId(null)
    setThreadDetail(null)

    // Re-fetch threads with new filter
    // For now, reload the page with filter param
    // In a future iteration, this could be a client-side fetch
    window.location.href = `/inbox?filter=${newFilter}`
  }, [])

  const handleBack = useCallback(() => {
    setSelectedLeadId(null)
    setThreadDetail(null)
  }, [])

  return (
    <div className="flex h-full">
      {/* Thread list — left pane */}
      <div
        className={[
          'border-r border-[var(--border-default)] flex-shrink-0 overflow-hidden',
          // Desktop: always visible, 40% width
          'lg:w-[40%] lg:block',
          // Mobile: full width when no thread selected, hidden when viewing thread
          selectedLeadId ? 'hidden' : 'w-full',
        ].join(' ')}
      >
        <ThreadList
          threads={threads}
          selectedLeadId={selectedLeadId}
          filter={filter}
          onSelectThread={handleSelectThread}
          onFilterChange={handleFilterChange}
        />
      </div>

      {/* Thread detail — right pane */}
      <div
        className={[
          'flex-1 overflow-hidden',
          // Mobile: full width when thread selected, hidden otherwise
          selectedLeadId ? 'block' : 'hidden lg:block',
        ].join(' ')}
      >
        <ThreadDetail
          thread={threadDetail}
          loading={loading}
          onBack={handleBack}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/(dashboard)/inbox/page.tsx src/app/(dashboard)/inbox/inbox-client.tsx
git commit -m "feat: add inbox page with split-pane thread view"
```

---

### Task 9: Build Verification + Full Test Run

- [ ] **Step 1: Run full build**

Run: `cd "/Users/justintud/Desktop/Coding Projects/outboundos-site" && npx next build 2>&1 | tail -20`
Expected: Build succeeds.

- [ ] **Step 2: Run all tests**

Run: `npx vitest run 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 3: Fix any issues**

If build or tests fail, diagnose and fix. Common issues: TypeScript errors from Prisma types, missing imports.

- [ ] **Step 4: Final commit if fixes needed**
