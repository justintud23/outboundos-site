// Minimal Microsoft Graph client: app-only (client-credentials) auth against a
// single sending tenant, plus a fetch wrapper that maps HTTP failures onto
// typed errors the send queue / inbox monitor act on.

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'
const GRAPH_ORIGIN = 'https://graph.microsoft.com/'
const LOGIN_BASE = 'https://login.microsoftonline.com'
const REQUEST_TIMEOUT_MS = 20_000

export class GraphError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message)
    this.name = 'GraphError'
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** 401/403 or token failure: consent revoked, secret expired, or mailbox outside the access policy. */
export class GraphAuthError extends GraphError {
  constructor(message: string, status: number, code?: string) {
    super(message, status, code)
    this.name = 'GraphAuthError'
  }
}

/** 429/503: back off for retryAfterSeconds. */
export class GraphThrottledError extends GraphError {
  constructor(message: string, status: number, public readonly retryAfterSeconds: number) {
    super(message, status)
    this.name = 'GraphThrottledError'
  }
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>()

export function __resetGraphTokenCache(): void {
  tokenCache.clear()
}

export async function getGraphToken(tenantId: string): Promise<string> {
  const cached = tokenCache.get(tenantId)
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token

  const clientId = process.env.MS_GRAPH_CLIENT_ID
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('MS_GRAPH_CLIENT_ID / MS_GRAPH_CLIENT_SECRET are not set')
  }

  const res = await fetch(`${LOGIN_BASE}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GraphAuthError(`Graph token request failed (${res.status}): ${text.slice(0, 300)}`, res.status)
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache.set(tenantId, { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 })
  return json.access_token
}

export interface GraphRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  prefer?: string[]
}

export async function graphFetch<T>(
  tenantId: string,
  pathOrUrl: string,
  opts: GraphRequestOptions = {},
): Promise<T> {
  let url: string
  if (pathOrUrl.startsWith('https://')) {
    // Delta/next links come back from Graph and are stored in the DB. Never
    // send our bearer token anywhere else.
    if (!pathOrUrl.startsWith(GRAPH_ORIGIN)) throw new Error(`Refusing to call non-Graph URL: ${pathOrUrl}`)
    url = pathOrUrl
  } else {
    url = `${GRAPH_BASE}${pathOrUrl}`
  }

  const token = await getGraphToken(tenantId)
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Prefer: ['IdType="ImmutableId"', ...(opts.prefer ?? [])].join(', '),
  }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    ...(opts.body !== undefined && { body: JSON.stringify(opts.body) }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  if (res.status === 202 || res.status === 204) return undefined as T
  if (res.ok) return (await res.json()) as T

  const text = await res.text().catch(() => '')
  let message = text.slice(0, 300)
  let code: string | undefined
  try {
    const parsed = JSON.parse(text) as { error?: { code?: string; message?: string } }
    code = parsed.error?.code
    message = parsed.error?.message ?? message
  } catch {
    // non-JSON error body
  }

  if (res.status === 429 || res.status === 503) {
    const retryAfter = Number(res.headers.get('retry-after'))
    throw new GraphThrottledError(message, res.status, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 60)
  }
  if (res.status === 401) {
    tokenCache.delete(tenantId)
    throw new GraphAuthError(message, 401, code)
  }
  if (res.status === 403) throw new GraphAuthError(message, 403, code)
  throw new GraphError(message, res.status, code)
}
