# OutboundOS — Demo Script

**Duration:** 5–7 minutes
**Setup:** Open https://outboundos-site.vercel.app, signed in, on Dashboard.

---

## Opening (30 seconds)

> "Most outbound tools show you data — open rates, reply counts, pipeline charts. OutboundOS does something different. It tells you what to do next, explains why, and lets you do it without leaving the page."

---

## 1. Dashboard (60 seconds)

**Show:** KPI cards at top, then scroll to Action Center module.

> "The dashboard gives you the high-level view — messages sent, replies, pipeline status. But the real value is here."

**Point to:** Action Center module in the dashboard.

> "This is the Action Center. The system is constantly scanning your pipeline — pending drafts, unread replies, stale leads, interested prospects — and surfacing the highest-priority work. Each action has a reason and urgency level."

**Point to:** An action item with reasoning text.

> "It's not a notification list. It's a decision engine."

---

## 2. Action Center Page (60 seconds)

**Navigate to:** /action-center

> "The full Action Center shows every action across your pipeline, ranked by priority."

**Point to:** Different action types.

> "Review this reply — it came in 2 hours ago, urgency is high. Approve this draft — it's been waiting since yesterday. Follow up with this lead — they replied but we haven't responded."

**Point to:** Reasoning text on an action.

> "Each action tells you *why* it matters. Not just 'approve this draft,' but 'created 3 hours ago, awaiting approval.' The system is opinionated about what you should do next."

---

## 3. Lead Command Center (90 seconds)

**Navigate to:** Click on a lead name from the Action Center (or go to /leads, click a lead).

> "This is the Lead Command Center. Everything about one lead, in one place."

**Point to:** Header.

> "Name, company, status, score — the basics. But look at the layout."

**Point to:** Timeline tab.

> "On the left, a unified timeline. Every email sent, reply received, status change, sequence step — in chronological order. You can see the full story of this lead at a glance."

**Switch to:** Messages tab.

> "Switch to Messages for a threaded view of the actual email conversation."

**Point to:** Right sidebar.

> "On the right — the actions panel shows what to do *for this specific lead*. Below that, sequence progress and lead metadata."

---

## 4. Inline Actions (90 seconds) — The Key Moment

**Point to:** An action in the right panel (e.g., "Approve Draft").

> "Here's where it gets interesting. I don't need to navigate to the drafts page to approve this. Watch."

**Click:** "Approve" button.

> "Instant. The row shows 'Approved' with an undo option. The API call is happening in the background. If I made a mistake..."

**Point to:** Undo button (if still visible).

> "...I can undo within 3 seconds. After that, the row collapses smoothly, and the server confirms the change."

**If a "Send" action is now visible, click it.**

> "Now a Send action appeared — because the draft was just approved. I can send it right here."

**Click:** "Send" button.

> "Same pattern. Instant feedback, background execution, server confirmation. No page navigation, no context switching."

---

## 5. Timeline Update (30 seconds)

**Click:** Timeline tab (if not already active).

> "After the page refreshes, you'll see the new events in the timeline — the approval, the send, any status changes. The full audit trail, automatically."

---

## 6. Pipeline + Sequences (optional, 60 seconds)

**Navigate to:** /pipeline

> "The pipeline board gives you a drag-and-drop view of every lead by status. Click any lead name to jump to their Command Center."

**Navigate to:** /sequences

> "Sequences handle multi-step automated outreach. Leads are enrolled, steps execute on schedule, and the system automatically stops if a lead replies or enters a terminal state."

---

## Closing (30 seconds)

> "The core loop is simple: the system surfaces what matters, explains why, and gives you a one-click path to execute. Insight to action to execution — without leaving the page."

> "That's OutboundOS."

---

## If Asked About Tech

- **Next.js 16 App Router** — server components for data, client for interactions
- **Prisma + Neon Postgres** — multi-tenant with org-scoped queries
- **Clerk** — auth with organization-level isolation
- **Optimistic UI** — ghost states, undo, server revalidation as source of truth
- **250+ tests** — server logic, components, edge cases
- **Feature-based architecture** — each domain (leads, drafts, actions, sequences) is a self-contained module
