import { describe, it, expect, vi } from 'vitest'
import { interpretMillionVerifier, createMillionVerifier } from './millionverifier'
import { getVerifier, isVerificationConfigured } from './get-verifier'

describe('interpretMillionVerifier', () => {
  it.each(['ok', 'catch_all', 'unknown', 'invalid', 'disposable'] as const)('maps result %s', (result) => {
    expect(interpretMillionVerifier(200, { email: 'a@b.com', result, resultcode: 1, error: '' })).toEqual({ kind: 'result', result })
  })

  it('treats result "error" and a missing result as retry', () => {
    expect(interpretMillionVerifier(200, { result: 'error', error: '' }).kind).toBe('retry')
    expect(interpretMillionVerifier(200, {}).kind).toBe('retry')
    expect(interpretMillionVerifier(200, null).kind).toBe('retry')
  })

  it('maps credit and key errors to account problems', () => {
    expect(interpretMillionVerifier(200, { error: 'Insufficient credits' })).toEqual({ kind: 'account', reason: 'no_credits' })
    expect(interpretMillionVerifier(200, { error: 'apikey not found' })).toEqual({ kind: 'account', reason: 'bad_key' })
    expect(interpretMillionVerifier(401, null)).toEqual({ kind: 'account', reason: 'bad_key' })
    expect(interpretMillionVerifier(402, null)).toEqual({ kind: 'account', reason: 'no_credits' })
  })

  it('treats other errors and 5xx as retry', () => {
    expect(interpretMillionVerifier(200, { error: 'temporary failure' })).toEqual({ kind: 'retry', reason: 'temporary failure' })
    expect(interpretMillionVerifier(503, null)).toEqual({ kind: 'retry', reason: 'HTTP 503' })
  })
})

describe('createMillionVerifier', () => {
  it('calls the v3 endpoint with the encoded key and email', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: 'ok', error: '' }), { status: 200 }))
    const outcome = await createMillionVerifier('k&y', fetchImpl).verify('jane+1@acme.com')
    expect(outcome).toEqual({ kind: 'result', result: 'ok' })
    const url = String(fetchImpl.mock.calls[0]![0])
    expect(url).toBe('https://api.millionverifier.com/api/v3/?api=k%26y&email=jane%2B1%40acme.com&timeout=10')
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({ signal: expect.any(AbortSignal) })
  })

  it('turns a network error or timeout into retry', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('The operation was aborted due to timeout'))
    expect(await createMillionVerifier('k', fetchImpl).verify('a@b.com')).toEqual({ kind: 'retry', reason: 'The operation was aborted due to timeout' })
  })

  it('turns a non-JSON body into retry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }))
    expect((await createMillionVerifier('k', fetchImpl).verify('a@b.com')).kind).toBe('retry')
  })
})

describe('getVerifier', () => {
  it('returns null and reports unconfigured when the key is unset or blank', () => {
    expect(getVerifier({} as NodeJS.ProcessEnv)).toBeNull()
    expect(isVerificationConfigured({ MILLIONVERIFIER_API_KEY: '  ' } as NodeJS.ProcessEnv)).toBe(false)
  })

  it('returns a verifier when the key is set', () => {
    expect(getVerifier({ MILLIONVERIFIER_API_KEY: 'k' } as NodeJS.ProcessEnv)).not.toBeNull()
    expect(isVerificationConfigured({ MILLIONVERIFIER_API_KEY: 'k' } as NodeJS.ProcessEnv)).toBe(true)
  })
})
