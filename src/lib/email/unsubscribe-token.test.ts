import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token'

const SECRET = 'test-unsubscribe-secret'
const payload = { leadId: 'lead-123', organizationId: 'org-456' }

beforeEach(() => {
  process.env.UNSUBSCRIBE_TOKEN_SECRET = SECRET
})

afterEach(() => {
  delete process.env.UNSUBSCRIBE_TOKEN_SECRET
})

describe('unsubscribe-token', () => {
  it('round-trips: a signed token verifies back to the original payload', () => {
    const token = signUnsubscribeToken(payload)
    expect(verifyUnsubscribeToken(token)).toEqual(payload)
  })

  it('produces an opaque, url-safe token with no raw ids in it', () => {
    const token = signUnsubscribeToken(payload)
    // url-safe base64url: only [A-Za-z0-9_-], no '+', '/', '=' that need encoding.
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    // The lead/org ids must not be readable from the token string.
    expect(token).not.toContain('lead-123')
    expect(token).not.toContain('org-456')
  })

  it('produces a different token each call (random IV) but both verify', () => {
    const a = signUnsubscribeToken(payload)
    const b = signUnsubscribeToken(payload)
    expect(a).not.toBe(b)
    expect(verifyUnsubscribeToken(a)).toEqual(payload)
    expect(verifyUnsubscribeToken(b)).toEqual(payload)
  })

  it('fails verification for a tampered token', () => {
    const token = signUnsubscribeToken(payload)
    // Flip a byte in the decoded token (the IV region) so the GCM auth tag no
    // longer matches. Mutating at the byte level — rather than flipping the last
    // base64 character, whose low bits may be discarded padding — guarantees the
    // decoded bytes actually change.
    const raw = Buffer.from(token, 'base64url')
    raw[0] = raw[0] ^ 0xff
    const tampered = raw.toString('base64url')
    expect(verifyUnsubscribeToken(tampered)).toBeNull()
  })

  it('fails verification when signed with a different secret', () => {
    const token = signUnsubscribeToken(payload)
    process.env.UNSUBSCRIBE_TOKEN_SECRET = 'a-totally-different-secret'
    expect(verifyUnsubscribeToken(token)).toBeNull()
  })

  it('returns null for malformed / non-token input', () => {
    expect(verifyUnsubscribeToken('')).toBeNull()
    expect(verifyUnsubscribeToken('not-a-real-token')).toBeNull()
  })

  it('throws if the secret is not configured when signing', () => {
    delete process.env.UNSUBSCRIBE_TOKEN_SECRET
    expect(() => signUnsubscribeToken(payload)).toThrow('UNSUBSCRIBE_TOKEN_SECRET is not set')
  })
})
