import crypto from 'node:crypto'
import { SF_FETCH_TIMEOUT_MS, getSalesforceAppConfig, loginHostFor, salesforceCallbackUrl, type SfEnv } from '../config'
import { SalesforceApiError, SalesforceAuthError } from './errors'

export const SF_PKCE_COOKIE = 'sf_pkce'
// Scoped to the callback path only — the connect route sets it here, and the
// callback route must delete it with this exact path or the browser keeps
// the original cookie (a delete with a mismatched path sets a *second*,
// already-expired cookie rather than removing the live one).
export const SF_PKCE_COOKIE_PATH = '/api/integrations/salesforce/callback'
const STATE_TTL_MS = 10 * 60 * 1000

export interface ConnectState { orgId: string; memberId: string; env: SfEnv; nonce: string; exp: number }

function stateKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY
  if (!raw) throw new Error('TOKEN_ENCRYPTION_KEY is not set')
  return crypto.createHash('sha256').update(`sf-state:${raw}`).digest()
}

export function signState(s: { orgId: string; memberId: string; env: SfEnv }, now = Date.now()): string {
  const payload: ConnectState = { ...s, nonce: crypto.randomBytes(12).toString('base64url'), exp: now + STATE_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', stateKey()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(token: string, now = Date.now()): ConnectState | null {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [body, sig] = parts
  if (!body || !sig) return null
  const expected = crypto.createHmac('sha256', stateKey()).update(body).digest()
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ConnectState
    if (typeof s.exp !== 'number' || s.exp < now) return null
    if (s.env !== 'production' && s.env !== 'sandbox') return null
    return s
  } catch {
    return null
  }
}

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString('base64url')
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

function requireConfig() {
  const cfg = getSalesforceAppConfig()
  if (!cfg) throw new Error('Salesforce is not configured on this server')
  return cfg
}

export function buildAuthorizeUrl({ env, state, challenge }: { env: SfEnv; state: string; challenge: string }): string {
  const { clientId } = requireConfig()
  const url = new URL('/services/oauth2/authorize', loginHostFor(env))
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: salesforceCallbackUrl(),
    scope: 'api refresh_token id',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

async function tokenRequest(host: string, params: Record<string, string>) {
  const res = await fetch(`${host}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(SF_FETCH_TIMEOUT_MS),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, string>
  return { ok: res.ok, status: res.status, data }
}

export async function exchangeCode({ env, code, verifier }: { env: SfEnv; code: string; verifier: string }) {
  const { clientId, clientSecret } = requireConfig()
  const { ok, status, data } = await tokenRequest(loginHostFor(env), {
    grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: salesforceCallbackUrl(), code_verifier: verifier,
  })
  if (!ok || !data.refresh_token || !data.access_token || !data.instance_url || !data.id) {
    throw new SalesforceApiError(status, data.error ?? 'TOKEN_EXCHANGE_FAILED', data.error_description ?? 'Salesforce token exchange failed')
  }
  return { accessToken: data.access_token, refreshToken: data.refresh_token, instanceUrl: data.instance_url, idUrl: data.id }
}

export async function fetchIdentity(idUrl: string, accessToken: string) {
  const res = await fetch(idUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(SF_FETCH_TIMEOUT_MS),
  })
  const data = (await res.json().catch(() => ({}))) as Record<string, string>
  if (!res.ok) throw new SalesforceApiError(res.status, 'IDENTITY_FAILED', 'Could not read the Salesforce user')
  if (!data.user_id || !data.organization_id) {
    throw new SalesforceApiError(502, 'IDENTITY_FAILED', 'Salesforce did not return the user or org id')
  }
  return { userId: data.user_id, orgId: data.organization_id, username: data.username ?? '', email: data.email ?? null }
}

export async function refreshAccessToken(loginHost: string, refreshToken: string) {
  const { clientId, clientSecret } = requireConfig()
  const { ok, status, data } = await tokenRequest(loginHost, {
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
  })
  if (!ok) {
    if (data.error === 'invalid_grant') throw new SalesforceAuthError(data.error_description ?? undefined)
    throw new SalesforceApiError(status, data.error ?? 'REFRESH_FAILED', data.error_description ?? 'Salesforce token refresh failed')
  }
  return { accessToken: data.access_token ?? '', instanceUrl: data.instance_url ?? '' }
}

export async function revokeToken(loginHost: string, token: string): Promise<void> {
  await fetch(`${loginHost}/services/oauth2/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(SF_FETCH_TIMEOUT_MS),
  }).catch(() => undefined)
}
