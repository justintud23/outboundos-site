import type { EmailVerifier, ProviderResult, VerifyOutcome } from '../provider'

const ENDPOINT = 'https://api.millionverifier.com/api/v3/'
export const CLIENT_TIMEOUT_MS = 15_000
const RESULTS: ReadonlySet<string> = new Set<ProviderResult>(['ok', 'catch_all', 'unknown', 'invalid', 'disposable'])

/** Map one MillionVerifier HTTP response to an outcome. Pure (tested with recorded shapes). */
export function interpretMillionVerifier(status: number, body: unknown): VerifyOutcome {
  if (status === 401 || status === 403) return { kind: 'account', reason: 'bad_key' }
  if (status === 402) return { kind: 'account', reason: 'no_credits' }
  const b = body && typeof body === 'object' ? (body as { result?: unknown; error?: unknown }) : null
  const error = typeof b?.error === 'string' ? b.error.trim() : ''
  if (error) {
    if (/credit/i.test(error)) return { kind: 'account', reason: 'no_credits' }
    if (/api\s?key|unauthori[sz]ed|forbidden/i.test(error)) return { kind: 'account', reason: 'bad_key' }
    return { kind: 'retry', reason: error }
  }
  if (status < 200 || status >= 300) return { kind: 'retry', reason: `HTTP ${status}` }
  const result = typeof b?.result === 'string' ? b.result : ''
  if (RESULTS.has(result)) return { kind: 'result', result: result as ProviderResult }
  return { kind: 'retry', reason: `result ${result || 'missing'}` }
}

export function createMillionVerifier(apiKey: string, fetchImpl: typeof fetch = fetch): EmailVerifier {
  return {
    async verify(email) {
      const url = `${ENDPOINT}?api=${encodeURIComponent(apiKey)}&email=${encodeURIComponent(email)}&timeout=10`
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) })
        const body: unknown = await res.json().catch(() => null)
        return interpretMillionVerifier(res.status, body)
      } catch (err) {
        return { kind: 'retry', reason: err instanceof Error ? err.message : String(err) }
      }
    },
  }
}
