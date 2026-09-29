import crypto from 'node:crypto'

// Encrypts third-party refresh tokens at rest. Format: v1:<iv>:<tag>:<ciphertext> (base64).
const ALGORITHM = 'aes-256-gcm'

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set')
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
  return key
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptToken(enc: string): string {
  const [version, iv, tag, ct] = enc.split(':')
  if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unrecognized token format')
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}
