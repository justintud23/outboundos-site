import { prisma } from '@/lib/db/prisma'
import { getEmailProvider } from '@/lib/email'
import { signUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import { getAIProvider } from '@/lib/ai'
import { renderTemplate, insertPersonalization, PERSONALIZATION_TOKEN } from '@/features/sequences/render-template'
import { checkGuardrails } from '@/features/drafts/guardrails'
import { effectiveDailyLimit } from '@/features/mailboxes/warmup'
import { getDomainHealthMap, domainOf } from '@/features/deliverability/server/domain-health'
import { isDomainUsable } from '@/features/deliverability/readiness'
import { startOfDay, reserveMailboxSlot, releaseMailboxSlot } from '@/features/mailboxes/server/mailbox-slots'
import { DomainNotHealthyError } from '@/features/messages/types'

export interface PlacementTestInput {
  organizationId: string
  campaignId: string
  sequenceId: string
  mailboxId: string
  leadId?: string | null // optional sample lead (must belong to the org)
  seeds: string[] // raw strings from the textarea
  clerkUserId: string
}

export interface PlacementTestResult {
  mailbox: string // from address
  requested: number
  sent: number
  failed: { to: string; error: string }[]
  // True only when the step had a personalization prompt + token AND the AI
  // call failed, so the sent test email is missing its {personalization} line.
  // A real send would instead be held for review (see run-sequence-step's
  // aiFailed → AI_FAILED guardrail flag); a placement test keeps sending so the
  // tester still gets a placement reading, but flags the gap.
  personalizationSkipped: boolean
}

export const MAX_SEEDS = 30

export type PlacementTestErrorCode =
  | 'INVALID_SEEDS'
  | 'NOT_FOUND'
  | 'MAILBOX_UNAVAILABLE'
  | 'DOMAIN_NOT_HEALTHY'
  | 'NO_FIRST_STEP'
  | 'GUARDRAIL_BLOCKED'
  | 'NO_CAPACITY'
  | 'MISSING_POSTAL_ADDRESS'
  | 'NOT_MICROSOFT'

export class PlacementTestError extends Error {
  constructor(public readonly code: PlacementTestErrorCode, message: string) {
    super(message)
    this.name = 'PlacementTestError'
    Object.setPrototypeOf(this, PlacementTestError.prototype)
  }
}

// Built-in sample used when no real lead is picked. Not a real Lead row — never
// persisted, never counted anywhere leads are counted.
export const SAMPLE_LEAD = {
  firstName: 'Jane',
  lastName: 'Sample',
  company: 'Acme Property Group',
  title: 'Property Manager',
  customFields: null as unknown,
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function parseSeeds(raw: string[]): string[] {
  const seen = new Set<string>()
  const seeds: string[] = []
  for (const s of raw) {
    const trimmed = s.trim().toLowerCase()
    if (!trimmed || seen.has(trimmed)) continue
    seen.add(trimmed)
    seeds.push(trimmed)
  }
  return seeds
}

export async function sendPlacementTest(input: PlacementTestInput): Promise<PlacementTestResult> {
  const { organizationId, campaignId, sequenceId, mailboxId, leadId, clerkUserId } = input

  // 1. Seeds — validate before any DB/network work.
  const seeds = parseSeeds(input.seeds)
  if (seeds.length === 0) {
    throw new PlacementTestError('INVALID_SEEDS', 'Enter at least one seed address.')
  }
  if (seeds.length > MAX_SEEDS) {
    throw new PlacementTestError(
      'INVALID_SEEDS',
      `Enter at most ${MAX_SEEDS} seed addresses (got ${seeds.length}).`,
    )
  }
  const badSeed = seeds.find((s) => !EMAIL_RE.test(s))
  if (badSeed) {
    throw new PlacementTestError('INVALID_SEEDS', `"${badSeed}" doesn't look like a valid email address.`)
  }

  // 2. Org.
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      msTenantId: true,
      businessName: true,
      postalAddress: true,
      guardrailBlockedPhrases: true,
      guardrailAllowedWords: true,
    },
  })
  if (!org?.msTenantId) {
    throw new PlacementTestError('NOT_MICROSOFT', 'Connect Microsoft 365 in Settings to send placement tests.')
  }
  const postalAddress = org.postalAddress?.trim()
  if (!postalAddress) {
    throw new PlacementTestError(
      'MISSING_POSTAL_ADDRESS',
      'Add your business mailing address in Settings before sending. US law (CAN-SPAM) requires it in every email.',
    )
  }

  // 3. Campaign and sequence.
  const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, organizationId } })
  if (!campaign) {
    throw new PlacementTestError('NOT_FOUND', 'Campaign not found.')
  }
  const sequence = await prisma.sequence.findFirst({
    where: { id: sequenceId, organizationId, campaignId },
    include: { steps: true },
  })
  if (!sequence) {
    throw new PlacementTestError('NOT_FOUND', 'Sequence not found.')
  }
  const step = sequence.steps.find((s) => s.stepNumber === 1)
  if (!step) {
    throw new PlacementTestError('NO_FIRST_STEP', 'This sequence has no first step yet.')
  }

  // 4. Mailbox.
  const mailbox = await prisma.mailbox.findFirst({ where: { id: mailboxId, organizationId } })
  if (!mailbox) {
    throw new PlacementTestError('NOT_FOUND', 'Mailbox not found.')
  }
  if (mailbox.provider !== 'MICROSOFT_GRAPH' || !mailbox.isActive || mailbox.autoPaused) {
    throw new PlacementTestError('MAILBOX_UNAVAILABLE', 'This mailbox is not available to send from right now.')
  }
  const domainHealth = await getDomainHealthMap(organizationId)
  const domain = domainOf(mailbox.email)
  const domainRow = domainHealth.get(domain) ?? null
  if (!isDomainUsable(domainRow?.status)) {
    // Reuse DomainNotHealthyError's exact wording rather than re-deriving it.
    const domainErr = new DomainNotHealthyError(domain, domainRow?.status ?? 'UNVERIFIED')
    throw new PlacementTestError('DOMAIN_NOT_HEALTHY', domainErr.message)
  }

  // 5. Sample lead.
  let lead: {
    firstName: string | null
    lastName: string | null
    company: string | null
    title: string | null
    customFields: unknown
  }
  if (leadId) {
    const found = await prisma.lead.findFirst({
      where: { id: leadId, organizationId },
      select: { firstName: true, lastName: true, company: true, title: true, customFields: true },
    })
    if (!found) {
      throw new PlacementTestError('NOT_FOUND', 'Lead not found.')
    }
    lead = found
  } else {
    lead = SAMPLE_LEAD
  }

  // 6. Render, the same way run-sequence-step builds a first-step draft.
  const subject = renderTemplate(step.subject, lead)
  let personalization: string | null = null
  let personalizationSkipped = false
  if (step.personalizationPrompt && step.body.includes(PERSONALIZATION_TOKEN)) {
    try {
      personalization = await getAIProvider().personalize(
        { firstName: lead.firstName, lastName: lead.lastName, company: lead.company, title: lead.title, customFields: lead.customFields },
        step.personalizationPrompt,
      )
    } catch {
      // On AI failure, insert nothing — mirrors run-sequence-step's aiFailed path.
      // Unlike a real send (which would be held for review), a placement test
      // keeps going so the tester still gets a placement reading, but the
      // result flags that the line is missing.
      personalization = null
      personalizationSkipped = true
    }
  }
  const body = renderTemplate(insertPersonalization(step.body, personalization), lead)

  const flags = checkGuardrails({
    subject,
    body,
    personalization,
    templateText: `${step.subject}\n${step.body}`,
    blockedPhrases: org.guardrailBlockedPhrases,
    allowedWords: org.guardrailAllowedWords,
  })
  if (flags.length > 0) {
    throw new PlacementTestError(
      'GUARDRAIL_BLOCKED',
      `This email was blocked by guardrails: ${flags.map((f) => `${f.rule} (${f.match})`).join(', ')}.`,
    )
  }

  // 7. Capacity — reserve one slot per seed, atomically, before any send.
  const now = new Date()
  const startOfToday = startOfDay(now)
  const limit = effectiveDailyLimit(mailbox, now, domainRow)

  // Release a previously-reserved slot without letting a release failure abort
  // whatever the caller is doing next (rollback, or the remaining sends).
  async function releaseSlotSafely(context: string): Promise<void> {
    await releaseMailboxSlot(mailboxId).catch((relErr: unknown) => {
      console.error(`[sendPlacementTest] Failed to release mailbox slot ${mailboxId} ${context}:`, relErr)
    })
  }

  let reservedCount = 0
  try {
    for (let i = 0; i < seeds.length; i++) {
      const ok = await reserveMailboxSlot(mailboxId, limit, startOfToday)
      if (!ok) break
      reservedCount++
    }
  } catch (err) {
    // A throw mid-loop (not just a false return) still leaves reservedCount
    // slots claimed — release them before propagating the error.
    for (let i = 0; i < reservedCount; i++) {
      await releaseSlotSafely('after a reservation error')
    }
    throw err
  }
  if (reservedCount < seeds.length) {
    for (let i = 0; i < reservedCount; i++) {
      await releaseSlotSafely('after NO_CAPACITY')
    }
    throw new PlacementTestError(
      'NO_CAPACITY',
      `Only ${reservedCount} sends left today on ${mailbox.email}; use ${reservedCount} seed addresses or try tomorrow.`,
    )
  }

  // 8. Send, sequentially. The unsubscribe token uses a placeholder leadId
  // ('placement-test') that no real Lead ever has, so the /api/unsubscribe
  // route's "unknown lead → no-op" behavior means clicking it can never
  // unsubscribe a real lead.
  const unsubscribeToken = signUnsubscribeToken({ leadId: 'placement-test', organizationId })
  const unsubscribeUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/unsubscribe?token=${unsubscribeToken}`

  const provider = getEmailProvider({ msTenantId: org.msTenantId })
  const failed: { to: string; error: string }[] = []
  let sent = 0

  for (const seed of seeds) {
    try {
      await provider.sendEmail({
        to: seed,
        fromEmail: mailbox.email,
        fromName: mailbox.displayName,
        subject,
        body,
        sender: { businessName: org.businessName, postalAddress },
        listUnsubscribe: { url: unsubscribeUrl },
      })
      sent++
    } catch (err) {
      failed.push({ to: seed, error: err instanceof Error ? err.message : 'Send failed' })
      await releaseSlotSafely(`after a send error for ${seed}`)
    }
  }

  // 9. Record — no Draft, OutboundMessage or Lead rows; one audit row, seeds omitted.
  // An audit-log failure must not turn a completed send into a 500 — the emails
  // are already out, so the result below is still returned either way.
  try {
    await prisma.auditLog.create({
      data: {
        organizationId,
        actorClerkId: clerkUserId,
        action: 'campaign.placement_test_sent',
        entityType: 'Campaign',
        entityId: campaignId,
        metadata: { mailboxId, sequenceId, requested: seeds.length, sent, failed: failed.length },
      },
    })
  } catch (err) {
    console.error(`[sendPlacementTest] Failed to write audit log for campaign ${campaignId}:`, err)
  }

  return { mailbox: mailbox.email, requested: seeds.length, sent, failed, personalizationSkipped }
}
