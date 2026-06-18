import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { SendGridRawEvent } from '../types'
import { mapEventType } from './map-event-type'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { LeadNotFoundError } from '@/features/leads/types'
import { evaluateMailboxBreaker } from '@/features/mailboxes/server/evaluate-mailbox-breaker'

interface IngestResult {
  processed: number
  skipped: number
}

export async function ingestWebhookEvents(events: SendGridRawEvent[]): Promise<IngestResult> {
  let processed = 0
  let skipped = 0

  for (const event of events) {
    if (!event.sg_event_id) { skipped++; continue }
    if (!event.draftId)     { skipped++; continue }

    const eventType = mapEventType(event.event)
    if (!eventType) { skipped++; continue }

    const message = await prisma.outboundMessage.findUnique({
      where: { draftId: event.draftId },
      select: { id: true, organizationId: true, leadId: true, mailboxId: true },
    })

    if (!message) {
      console.error(`[ingestWebhookEvents] OutboundMessage not found for draftId=${event.draftId}, sgEventId=${event.sg_event_id}`)
      skipped++
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
        rawPayload:        event as unknown as Prisma.InputJsonValue,
      },
      update: {},
    })

    // Suppression: an unsubscribe or spam complaint must stop further sends to
    // this lead, not just be recorded as an event. There is no dedicated
    // "suppressed"/"spam" LeadStatus, so both map to the terminal UNSUBSCRIBED
    // status (BOUNCED means delivery failure; NOT_INTERESTED means a reply —
    // neither fits a spam complaint). The `auto:` trigger keeps this idempotent
    // (already-terminal leads no-op) and transitioning into the terminal status
    // also stops the lead's ACTIVE sequence enrollments. The lead is resolved
    // from the OutboundMessage (org-scoped linkage), not from request-supplied
    // ids. This runs only inside ingestWebhookEvents, which the route calls
    // after SendGrid signature verification — so it only fires on authentic
    // webhooks.
    if (eventType === 'UNSUBSCRIBED' || eventType === 'SPAM_REPORT') {
      try {
        await transitionLeadStatus({
          organizationId: message.organizationId,
          leadId: message.leadId,
          newStatus: 'UNSUBSCRIBED',
          trigger: eventType === 'SPAM_REPORT'
            ? 'auto:sendgrid_spamreport'
            : 'auto:sendgrid_unsubscribe',
          metadata: { sgEventId: event.sg_event_id, providerEvent: event.event },
        })
      } catch (err) {
        // Don't let a suppression failure abort the rest of the batch; the
        // event itself is already recorded above.
        if (!(err instanceof LeadNotFoundError)) {
          console.error(`[ingestWebhookEvents] Failed to suppress lead for ${event.event} event sgEventId=${event.sg_event_id}:`, err)
        }
      }
    }

    // Circuit breaker: a bounce or spam complaint may push this mailbox's recent
    // rate past the safe threshold — re-evaluate and auto-pause if so. Best-effort
    // and idempotent: a failure here must never abort the rest of the batch (the
    // event is already recorded above), and an already-paused mailbox is a no-op.
    if (eventType === 'BOUNCED' || eventType === 'SPAM_REPORT') {
      try {
        await evaluateMailboxBreaker(message.mailboxId)
      } catch (err) {
        console.error(`[ingestWebhookEvents] Circuit-breaker eval failed for mailbox=${message.mailboxId} sgEventId=${event.sg_event_id}:`, err)
      }
    }

    processed++
  }

  return { processed, skipped }
}
