import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { SendGridRawEvent } from '../types'
import { mapEventType } from './map-event-type'

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
      select: { id: true, organizationId: true },
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

    processed++
  }

  return { processed, skipped }
}
