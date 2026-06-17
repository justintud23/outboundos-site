import { NextResponse } from 'next/server'
import { ingestWebhookEvents } from '@/features/events/server/ingest-webhook-events'
import {
  verifySendGridSignature,
  SENDGRID_SIGNATURE_HEADER,
  SENDGRID_TIMESTAMP_HEADER,
} from '@/features/events/server/verify-sendgrid-signature'
import type { SendGridRawEvent } from '@/features/events/types'

export async function POST(request: Request) {
  // Read the RAW body first. Signature verification must run against the exact
  // bytes SendGrid signed — parsing to JSON and re-serializing would break it.
  const rawBody = await request.text()

  const signature = request.headers.get(SENDGRID_SIGNATURE_HEADER)
  const timestamp = request.headers.get(SENDGRID_TIMESTAMP_HEADER)

  const verification = verifySendGridSignature(rawBody, signature, timestamp)

  if (verification === 'unconfigured') {
    if (process.env.NODE_ENV === 'production') {
      // Fail closed: a missing verification key in production means we CANNOT
      // authenticate the webhook, so we must refuse to ingest rather than trust
      // unsigned input. 503 so SendGrid retries once the key is configured.
      console.error(
        '[POST /api/webhooks/sendgrid] SENDGRID_WEBHOOK_VERIFICATION_KEY is unset in production — ' +
          'refusing to ingest unverified webhook (fail closed).',
      )
      return NextResponse.json({ error: 'Webhook verification not configured' }, { status: 503 })
    }
    // ⚠️ SECURITY: outside production, fall through WITHOUT verifying the
    // signature to keep local/dev/test working. This is INSECURE — any caller
    // can inject fake events. Set the key in every deployed env.
    console.warn(
      '[POST /api/webhooks/sendgrid] SENDGRID_WEBHOOK_VERIFICATION_KEY is unset — ' +
        'skipping signature verification (INSECURE, dev/local only).',
    )
  } else if (verification === 'invalid') {
    // Missing or wrong signature with a key configured — reject, do not ingest.
    console.warn('[POST /api/webhooks/sendgrid] Invalid or missing SendGrid signature — rejecting request')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(rawBody)
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
