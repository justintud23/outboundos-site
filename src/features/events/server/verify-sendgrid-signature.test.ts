import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Ecdsa, PrivateKey } from 'starkbank-ecdsa'
import { verifySendGridSignature } from './verify-sendgrid-signature'

// Generate a real ECDSA keypair once and sign payloads exactly the way SendGrid
// does (signature over `timestamp + rawBody`), so the verifier is exercised with
// genuine crypto rather than a mock.
const privateKey = new PrivateKey()
const publicKeyPem = privateKey.publicKey().toPem()

function sign(rawBody: string, timestamp: string): string {
  return Ecdsa.sign(timestamp + rawBody, privateKey).toBase64()
}

const RAW_BODY = JSON.stringify([{ event: 'delivered', sg_event_id: 'evt-1', draftId: 'draft-1' }])
const TIMESTAMP = '1700000000'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY = publicKeyPem
})

afterEach(() => {
  delete process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY
})

describe('verifySendGridSignature', () => {
  it('returns "valid" for a correctly signed payload', () => {
    const signature = sign(RAW_BODY, TIMESTAMP)
    expect(verifySendGridSignature(RAW_BODY, signature, TIMESTAMP)).toBe('valid')
  })

  it('returns "invalid" when the signature is for a different body (tampered payload)', () => {
    const signature = sign(RAW_BODY, TIMESTAMP)
    const tampered = JSON.stringify([{ event: 'delivered', sg_event_id: 'EVIL', draftId: 'draft-1' }])
    expect(verifySendGridSignature(tampered, signature, TIMESTAMP)).toBe('invalid')
  })

  it('returns "invalid" when the timestamp does not match what was signed', () => {
    const signature = sign(RAW_BODY, TIMESTAMP)
    expect(verifySendGridSignature(RAW_BODY, signature, '9999999999')).toBe('invalid')
  })

  it('returns "invalid" when the signature header is missing', () => {
    expect(verifySendGridSignature(RAW_BODY, null, TIMESTAMP)).toBe('invalid')
  })

  it('returns "invalid" when the timestamp header is missing', () => {
    const signature = sign(RAW_BODY, TIMESTAMP)
    expect(verifySendGridSignature(RAW_BODY, signature, null)).toBe('invalid')
  })

  it('returns "invalid" (never throws) for a garbage signature', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(verifySendGridSignature(RAW_BODY, 'not-base64-!!', TIMESTAMP)).toBe('invalid')
    consoleSpy.mockRestore()
  })

  it('returns "unconfigured" when SENDGRID_WEBHOOK_VERIFICATION_KEY is unset', () => {
    delete process.env.SENDGRID_WEBHOOK_VERIFICATION_KEY
    const signature = sign(RAW_BODY, TIMESTAMP)
    expect(verifySendGridSignature(RAW_BODY, signature, TIMESTAMP)).toBe('unconfigured')
  })
})
