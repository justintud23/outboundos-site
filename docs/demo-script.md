# OutboundOS — Demo Script

> Loom-style walkthrough. Target runtime: 60–90 seconds.
> Record at 1.0x speed with browser dev tools closed.

---

## Opening (5 sec)

> "This is OutboundOS — a multi-tenant outbound sales platform I built with Next.js, Prisma, and OpenAI. Let me walk you through it."

Start on the dashboard, already signed in to an organization.

---

## Step 1: Lead Import (10 sec)

Navigate to **Leads**.

> "I'll start by importing a CSV of leads. Each row becomes a scoped lead record — isolated to this organization at the database level."

Upload a CSV. Show the lead list populating.

---

## Step 2: AI Draft Generation (15 sec)

Navigate to **Campaigns → Drafts**.

> "OutboundOS uses OpenAI to generate personalized email drafts for each lead. The prompt template is configurable per org — organizations can bring their own messaging style."

Trigger draft generation. Show one or two drafts appear with subject line and body.

---

## Step 3: Draft Approval (10 sec)

Open a draft. Show the approval UI.

> "Drafts go through a review step before sending. A team member approves or rejects — nothing goes out without explicit sign-off."

Approve a draft.

---

## Step 4: Sending and Event Tracking (10 sec)

> "Approved drafts are sent via SendGrid. Each message is tracked individually — delivery, opens, clicks, bounces all come back as webhook events and are stored per-message."

Show the outbound messages list with status indicators. Mention that SendGrid webhooks hit `/api/webhooks/sendgrid` and events are upserted idempotently by `sgEventId`.

---

## Step 5: Reply Ingestion and Classification (15 sec)

Navigate to **Replies**.

> "When a lead replies, SendGrid Inbound Parse routes it here. The app runs it through OpenAI and classifies it — POSITIVE, NEUTRAL, NEGATIVE, OUT_OF_OFFICE, UNSUBSCRIBE_REQUEST, or REFERRAL."

Show the replies table. Point out the classification badges and the green highlight on a POSITIVE row. Filter by POSITIVE to show only interested leads.

---

## Step 6: Analytics Dashboard (10 sec)

Navigate to **Analytics**.

> "The analytics page shows 8 org-scoped KPIs in real time — sent, delivered, opened, clicked, replies, positive replies, bounced, unsubscribes. The event counts are deduplicated: one message counts as one open regardless of how many times SendGrid fires the event."

Show the KPI cards. Point to a computed rate (e.g. open rate or positive reply rate).

---

## Close (5 sec)

> "Everything here is org-scoped — multiple organizations can run on the same deployment with no data bleed. The test suite covers business logic with Prisma and OpenAI fully mocked. Thanks for watching."

---

## Notes for recording

- Use a seeded org with real-looking lead data (a CSV with 5–10 rows is enough)
- Have at least one POSITIVE reply pre-classified so the highlight is visible
- Keep browser zoom at 100%, window maximized
- Pause briefly on each screen before moving on — give viewers time to read
