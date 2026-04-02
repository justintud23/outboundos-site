import { NextResponse } from 'next/server'
import { ingestWebhookEvents } from '@/features/events/server/ingest-webhook-events'
import type { SendGridRawEvent } from '@/features/events/types'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    // Malformed JSON — log and ack so SendGrid doesn't retry forever
    console.warn('[POST /api/webhooks/sendgrid] Failed to parse JSON body')
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  if (!Array.isArray(body)) {
    console.warn('[POST /api/webhooks/sendgrid] Expected array, got:', typeof body)
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  try {
    const result = await ingestWebhookEvents(body as SendGridRawEvent[])
    return NextResponse.json({ ok: true, ...result }, { status: 200 })
  } catch (err) {
    // Log but still return 200 — application errors should not trigger SendGrid retries
    console.error('[POST /api/webhooks/sendgrid] Ingestion error:', err)
    return NextResponse.json({ ok: true }, { status: 200 })
  }
}
