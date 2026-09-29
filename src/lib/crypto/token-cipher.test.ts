import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { encryptToken, decryptToken } from './token-cipher'

const KEY = randomBytes(32).toString('base64')
let saved: string | undefined
beforeEach(() => { saved = process.env.TOKEN_ENCRYPTION_KEY; process.env.TOKEN_ENCRYPTION_KEY = KEY })
afterEach(() => { process.env.TOKEN_ENCRYPTION_KEY = saved })

describe('token cipher', () => {
  it('round-trips and uses the v1 format', () => {
    const enc = encryptToken('refresh-abc')
    expect(enc.startsWith('v1:')).toBe(true)
    expect(enc.split(':')).toHaveLength(4)
    expect(decryptToken(enc)).toBe('refresh-abc')
  })
  it('is non-deterministic', () => {
    expect(encryptToken('x')).not.toBe(encryptToken('x'))
  })
  it('rejects a tampered ciphertext', () => {
    const [v, iv, tag, ct] = encryptToken('refresh-abc').split(':') as [string, string, string, string]
    const flipped = Buffer.from(ct, 'base64'); flipped[0] = (flipped[0] ?? 0) ^ 1
    expect(() => decryptToken([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
  })
  it('rejects a different key', () => {
    const enc = encryptToken('refresh-abc')
    process.env.TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
    expect(() => decryptToken(enc)).toThrow()
  })
  it('throws a clear error when the key is missing or the wrong length', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY
    expect(() => encryptToken('x')).toThrow('TOKEN_ENCRYPTION_KEY is not set')
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64')
    expect(() => encryptToken('x')).toThrow('32 bytes')
  })
})
