/**
 * prisma/seed.ts
 *
 * Reset-based seed script for local development.
 *
 * USAGE:
 *   npx prisma db seed
 *
 * IMPORTANT — ORG CLERK ID:
 *   The seed creates one organization with clerkId = "org_demo".
 *   After signing into your local app, update this value to match
 *   your actual Clerk org ID (visible in the Clerk dashboard or URL),
 *   then re-run `npx prisma db seed`.
 *
 * RESET STRATEGY:
 *   Each run deletes all data for the demo org and recreates it fresh.
 *   This is intentional so the seed is idempotent — safe to run repeatedly.
 *   Deletion cascades are handled by Prisma's onDelete: Cascade rules.
 */

import { PrismaClient, MessageEventType, ReplyClassification } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// Load DATABASE_URL from .env (prisma.config.ts does this via dotenv, but
// seed runs standalone, so we load it here too).
import 'dotenv/config'

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Ensure a .env file exists.')
}

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })

// ─── HARDCODED IDS ───────────────────────────────────────────────
// Using deterministic IDs so we can safely upsert / delete on re-runs.

const ORG_ID      = 'seed_org_acme'
const MAILBOX_ID  = 'seed_mailbox_1'
const CAMPAIGN_ID = 'seed_campaign_1'
const SEQUENCE_ID = 'seed_sequence_1'
const STEP_ID     = 'seed_step_1'

const LEAD_IDS = Array.from({ length: 12 }, (_, i) => `seed_lead_${i + 1}`)
const MSG_IDS  = Array.from({ length: 12 }, (_, i) => `seed_msg_${i + 1}`)

// ─── DEMO DATA ───────────────────────────────────────────────────

const LEADS = [
  { firstName: 'Alice',   lastName: 'Johnson',   email: 'alice.johnson@stripe.com',     company: 'Stripe',     title: 'Head of Growth',        score: 88, status: 'CONTACTED' as const },
  { firstName: 'Ben',     lastName: 'Carter',    email: 'ben.carter@notion.so',          company: 'Notion',     title: 'VP of Engineering',     score: 76, status: 'REPLIED' as const },
  { firstName: 'Clara',   lastName: 'Singh',     email: 'clara.singh@linear.app',        company: 'Linear',     title: 'Product Lead',          score: 91, status: 'CONVERTED' as const },
  { firstName: 'Daniel',  lastName: 'Okafor',    email: 'd.okafor@figma.com',            company: 'Figma',      title: 'Engineering Manager',   score: 64, status: 'CONTACTED' as const },
  { firstName: 'Elena',   lastName: 'Vargas',    email: 'evargas@vercel.com',            company: 'Vercel',     title: 'Director of Sales',     score: 82, status: 'REPLIED' as const },
  { firstName: 'Frank',   lastName: 'Wu',        email: 'frank.wu@supabase.io',          company: 'Supabase',   title: 'CTO',                   score: 95, status: 'CONTACTED' as const },
  { firstName: 'Grace',   lastName: 'Thompson',  email: 'grace@planetscale.com',         company: 'PlanetScale','title': 'Senior Engineer',     score: 55, status: 'BOUNCED' as const },
  { firstName: 'Hiro',    lastName: 'Nakamura',  email: 'hiro.n@retool.com',             company: 'Retool',     title: 'Solutions Architect',   score: 71, status: 'CONTACTED' as const },
  { firstName: 'Iris',    lastName: 'Patel',     email: 'iris.patel@vercel.com',         company: 'Vercel',     title: 'Growth Engineer',       score: null, status: 'NEW' as const },
  { firstName: 'James',   lastName: 'O\'Brien',  email: 'james@clickup.com',             company: 'ClickUp',    title: 'VP Product',            score: 68, status: 'UNSUBSCRIBED' as const },
  { firstName: 'Kayla',   lastName: 'Morris',    email: 'k.morris@datadog.com',          company: 'Datadog',    title: 'Account Executive',     score: 79, status: 'REPLIED' as const },
  { firstName: 'Liam',    lastName: 'Nguyen',    email: 'liam.nguyen@hashicorp.com',     company: 'HashiCorp',  title: 'DevRel Engineer',       score: null, status: 'NEW' as const },
]

const INBOUND_REPLIES = [
  {
    id: 'seed_reply_1',
    classification: ReplyClassification.POSITIVE,
    confidence: 0.94,
    body: "Hey, this looks really interesting! I've been looking for something like this for our outbound team. Can we set up a 30-minute call this week to discuss pricing and onboarding?",
  },
  {
    id: 'seed_reply_2',
    classification: ReplyClassification.POSITIVE,
    confidence: 0.89,
    body: "Thanks for reaching out — your timing is actually perfect. We're evaluating tools for our SDR team right now. Would love to see a demo.",
  },
  {
    id: 'seed_reply_3',
    classification: ReplyClassification.POSITIVE,
    confidence: 0.91,
    body: "Sounds compelling. We've struggled with reply classification on our current setup. I'm forwarding this to our Head of RevOps — she'll be in touch.",
  },
  {
    id: 'seed_reply_4',
    classification: ReplyClassification.NEUTRAL,
    confidence: 0.77,
    body: "Got your note. Not sure this is the right fit right now, but I'll keep it in mind. Maybe check back in Q3.",
  },
  {
    id: 'seed_reply_5',
    classification: ReplyClassification.OUT_OF_OFFICE,
    confidence: 0.99,
    body: "I'm out of office until April 14th with limited access to email. For urgent matters, please contact my colleague at operations@example.com.",
  },
  {
    id: 'seed_reply_6',
    classification: ReplyClassification.UNSUBSCRIBE_REQUEST,
    confidence: 0.98,
    body: "Please remove me from your mailing list. I'm not interested and I haven't consented to receiving these messages.",
  },
]

// ─── SEED FUNCTION ───────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding OutboundOS demo data…')

  // ── 1. Wipe existing demo org data (cascade handles child records) ──
  await prisma.organization.deleteMany({ where: { id: ORG_ID } })
  console.log('  ✓ Cleared existing demo org')

  // ── 2. Create Organization ──
  const org = await prisma.organization.create({
    data: {
      id:      ORG_ID,
      clerkId: 'org_demo', // ← update this to your real Clerk org ID after signing in
      name:    'Acme Corp',
    },
  })
  console.log(`  ✓ Organization: ${org.name} (id=${org.id})`)

  // ── 3. Create Mailbox ──
  const mailbox = await prisma.mailbox.create({
    data: {
      id:             MAILBOX_ID,
      organizationId: org.id,
      email:          'outreach@acmecorp.demo',
      displayName:    'Acme Corp Outreach',
      isActive:       true,
      dailyLimit:     100,
    },
  })
  console.log(`  ✓ Mailbox: ${mailbox.email}`)

  // ── 4. Create Campaign ──
  const campaign = await prisma.campaign.create({
    data: {
      id:             CAMPAIGN_ID,
      organizationId: org.id,
      mailboxId:      mailbox.id,
      name:           'Q2 Outbound Blitz',
      description:    'Cold outbound to engineering leaders at Series B+ companies.',
      status:         'ACTIVE',
    },
  })
  console.log(`  ✓ Campaign: ${campaign.name}`)

  // ── 5. Create Sequence + Step ──
  const sequence = await prisma.sequence.create({
    data: {
      id:             SEQUENCE_ID,
      organizationId: org.id,
      campaignId:     campaign.id,
      name:           'Initial Touch → Follow Up',
    },
  })

  await prisma.sequenceStep.create({
    data: {
      id:         STEP_ID,
      sequenceId: sequence.id,
      stepNumber: 1,
      subject:    'Quick question about your outbound motion',
      body:       "Hi {{firstName}},\n\nI noticed your team is scaling quickly — curious if you're happy with how you're managing outbound right now?\n\nWe help teams like yours automate personalised sequences and classify replies automatically. Worth a quick chat?\n\nBest,\nThe Acme Team",
      delayDays:  0,
    },
  })
  console.log(`  ✓ Sequence + 1 step`)

  // ── 6. Create Leads ──
  const createdLeads = await Promise.all(
    LEADS.map((lead, i) =>
      prisma.lead.create({
        data: {
          id:             LEAD_IDS[i],
          organizationId: org.id,
          email:          lead.email,
          firstName:      lead.firstName,
          lastName:       lead.lastName,
          company:        lead.company,
          title:          lead.title,
          source:         'CSV',
          status:         lead.status,
          score:          lead.score ?? null,
          scoreReason:    lead.score !== null
            ? `Scored based on title seniority, company funding stage, and engagement signals.`
            : null,
          scoredAt:       lead.score !== null ? new Date('2026-03-28T10:00:00Z') : null,
        },
      }),
    ),
  )
  console.log(`  ✓ ${createdLeads.length} leads`)

  // ── 7. Create OutboundMessages (1 per lead) ──
  const messages = await Promise.all(
    createdLeads.map((lead, i) =>
      prisma.outboundMessage.create({
        data: {
          id:             MSG_IDS[i],
          organizationId: org.id,
          leadId:         lead.id,
          mailboxId:      mailbox.id,
          campaignId:     campaign.id,
          sgMessageId:    `sg-msg-${i + 1}`,
          subject:        'Quick question about your outbound motion',
          body:           `Hi ${lead.firstName},\n\nI noticed your team is scaling quickly — curious if you're happy with how you're managing outbound right now?\n\nWe help teams like yours automate personalised sequences and classify replies automatically. Worth a quick chat?\n\nBest,\nThe Acme Team`,
          status:         'SENT',
          sentAt:         new Date('2026-03-25T09:00:00Z'),
        },
      }),
    ),
  )
  console.log(`  ✓ ${messages.length} outbound messages`)

  // ── 8. Create MessageEvents ──
  // All 12: DELIVERED
  // First 9: OPENED
  // First 5: CLICKED
  // Message index 6 (0-based): BOUNCED
  // Message index 9 (0-based): UNSUBSCRIBED

  const eventRows: {
    outboundMessageId: string
    organizationId: string
    sgEventId: string
    eventType: MessageEventType
    rawPayload: object
    providerTimestamp: Date
  }[] = []

  for (let i = 0; i < 12; i++) {
    // DELIVERED — all 12
    eventRows.push({
      outboundMessageId: messages[i].id,
      organizationId:    org.id,
      sgEventId:         `evt-delivered-${i + 1}`,
      eventType:         MessageEventType.DELIVERED,
      rawPayload:        { event: 'delivered', sg_message_id: `sg-msg-${i + 1}` },
      providerTimestamp: new Date('2026-03-25T09:05:00Z'),
    })
  }

  for (let i = 0; i < 9; i++) {
    // OPENED — first 9
    eventRows.push({
      outboundMessageId: messages[i].id,
      organizationId:    org.id,
      sgEventId:         `evt-opened-${i + 1}`,
      eventType:         MessageEventType.OPENED,
      rawPayload:        { event: 'open', sg_message_id: `sg-msg-${i + 1}` },
      providerTimestamp: new Date('2026-03-25T11:30:00Z'),
    })
  }

  for (let i = 0; i < 5; i++) {
    // CLICKED — first 5
    eventRows.push({
      outboundMessageId: messages[i].id,
      organizationId:    org.id,
      sgEventId:         `evt-clicked-${i + 1}`,
      eventType:         MessageEventType.CLICKED,
      rawPayload:        { event: 'click', sg_message_id: `sg-msg-${i + 1}` },
      providerTimestamp: new Date('2026-03-25T12:00:00Z'),
    })
  }

  // BOUNCED — message index 6 (Grace Thompson, who has status BOUNCED)
  eventRows.push({
    outboundMessageId: messages[6].id,
    organizationId:    org.id,
    sgEventId:         'evt-bounced-1',
    eventType:         MessageEventType.BOUNCED,
    rawPayload:        { event: 'bounce', sg_message_id: 'sg-msg-7', type: 'permanent' },
    providerTimestamp: new Date('2026-03-25T09:10:00Z'),
  })

  // UNSUBSCRIBED — message index 9 (James O'Brien, who has status UNSUBSCRIBED)
  eventRows.push({
    outboundMessageId: messages[9].id,
    organizationId:    org.id,
    sgEventId:         'evt-unsubscribed-1',
    eventType:         MessageEventType.UNSUBSCRIBED,
    rawPayload:        { event: 'unsubscribe', sg_message_id: 'sg-msg-10' },
    providerTimestamp: new Date('2026-03-26T14:00:00Z'),
  })

  await prisma.messageEvent.createMany({ data: eventRows })
  console.log(`  ✓ ${eventRows.length} message events`)

  // ── 9. Create InboundReplies (6 total, linked to first 6 leads + messages) ──
  await prisma.inboundReply.createMany({
    data: INBOUND_REPLIES.map((r, i) => ({
      id:                       r.id,
      organizationId:           org.id,
      leadId:                   createdLeads[i].id,
      outboundMessageId:        messages[i].id,
      rawBody:                  r.body,
      classification:           r.classification,
      classificationConfidence: r.confidence,
      receivedAt:               new Date(`2026-03-2${6 + i}T10:00:00Z`),
    })),
  })
  console.log(`  ✓ ${INBOUND_REPLIES.length} inbound replies`)

  console.log('\n✅ Seed complete!')
  console.log('\nNOTE: The org is seeded with clerkId = "org_demo".')
  console.log('      Update this value in prisma/seed.ts to match your real Clerk org ID.')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
