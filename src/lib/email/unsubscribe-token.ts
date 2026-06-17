import crypto from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

export interface UnsubscribePayload {
  leadId: string
  organizationId: string
}

// Derive a fixed 32-byte AES key from the (arbitrary-length) secret.
function getKey(): Buffer {
  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET
  if (!secret) {
    throw new Error('UNSUBSCRIBE_TOKEN_SECRET is not set')
  }
  return crypto.createHash('sha256').update(secret).digest()
}

/**
 * Produce an opaque, url-safe unsubscribe token that the future
 * /api/unsubscribe endpoint can decrypt back into { leadId, organizationId }.
 *
 * Uses AES-256-GCM (authenticated encryption) rather than a signed-but-readable
 * payload, so the lead id never appears in the URL in any decodable form and any
 * tampering is detected on verify. The token is non-deterministic (random IV),
 * so the same lead yields a different token per send — each is independently
 * valid.
 */
export function signUnsubscribeToken(payload: UnsubscribePayload): string {
  const key = getKey()
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Layout: iv || authTag || ciphertext, base64url-encoded (no padding).
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64url')
}

/**
 * Reverse of signUnsubscribeToken. Returns the payload if the token is
 * authentic and was produced with the current secret; returns null if the token
 * is malformed, tampered with, or was signed with a different secret.
 */
export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  try {
    const key = getKey()
    const raw = Buffer.from(token, 'base64url')
    if (raw.length < IV_BYTES + AUTH_TAG_BYTES) {
      return null
    }
    const iv = raw.subarray(0, IV_BYTES)
    const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES)
    const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES)

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    const parsed = JSON.parse(plaintext.toString('utf8')) as Partial<UnsubscribePayload>
    if (typeof parsed.leadId !== 'string' || typeof parsed.organizationId !== 'string') {
      return null
    }
    return { leadId: parsed.leadId, organizationId: parsed.organizationId }
  } catch {
    // Auth-tag mismatch (tampered/wrong secret), bad base64, or bad JSON.
    return null
  }
}
