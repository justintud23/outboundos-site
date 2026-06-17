import { EventWebhook } from '@sendgrid/eventwebhook'

/**
 * Result of attempting to verify a SendGrid event webhook signature.
 *
 * - `valid`        — signature present and verified against the configured key.
 * - `invalid`      — key is configured but the signature is missing or wrong.
 * - `unconfigured` — SENDGRID_WEBHOOK_VERIFICATION_KEY is unset. The caller is
 *                    expected to fall through (insecure; dev/local only).
 */
export type SendGridVerificationResult = 'valid' | 'invalid' | 'unconfigured'

// SendGrid signs each event webhook request with these headers.
export const SENDGRID_SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature'
export const SENDGRID_TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp'

/**
 * Verify a signed SendGrid event webhook request.
 *
 * IMPORTANT: `rawBody` must be the exact raw request body string SendGrid
 * signed — never a re-serialized JSON.stringify of the parsed payload, which
 * would change whitespace/key order and break verification.
 */
export function verifySendGridSignature(
  rawBody: string,
  signature: string | null,
  timestamp: string | null,
): SendGridVerificationResult {
  const verificationKey = process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY

  if (!verificationKey) {
    return 'unconfigured'
  }

  if (!signature || !timestamp) {
    return 'invalid'
  }

  try {
    const eventWebhook = new EventWebhook()
    const ecdsaPublicKey = eventWebhook.convertPublicKeyToECDSA(verificationKey)
    const isValid = eventWebhook.verifySignature(ecdsaPublicKey, rawBody, signature, timestamp)
    return isValid ? 'valid' : 'invalid'
  } catch (err) {
    // A malformed key or signature throws — treat as invalid, never as authentic.
    console.error('[verifySendGridSignature] Verification error:', err)
    return 'invalid'
  }
}
