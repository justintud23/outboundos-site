import type { SalesforceConnection } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { encryptToken, decryptToken } from '@/lib/crypto/token-cipher'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { refreshAccessToken } from './oauth'
import { SalesforceAuthError } from './errors'

const TOKEN_TTL_MS = 50 * 60 * 1000 // Salesforce sessions last >= 2h by default; refresh well before.
// Keyed by organizationId. `refreshTokenEnc` pins the entry to the connection
// row it was minted from: on a multi-instance deploy, another instance's
// reconnect (new refresh token) or disconnect (row gone) is invisible to this
// process's cache, so every read is validated against the current row rather
// than trusted for up to TOKEN_TTL_MS.
interface TokenCacheEntry { accessToken: string; instanceUrl: string; refreshTokenEnc: string; at: number }
const tokenCache = new Map<string, TokenCacheEntry>()

export const CLEARED_LEAD_LINK = {
  salesforceId: null, salesforceType: null, salesforceAccountId: null,
  sfCheckStatus: null, sfCheckedAt: null, sfCheckDetail: null, sfBlockOverride: false, sfHeldSince: null,
} as const

export function getConnection(organizationId: string): Promise<SalesforceConnection | null> {
  return prisma.salesforceConnection.findUnique({ where: { organizationId } })
}

export interface SaveConnectionInput {
  instanceUrl: string; loginHost: string; sfOrgId: string; sfUserId: string
  sfUsername: string; sfUserEmail: string | null; refreshToken: string
}

export async function saveConnection(organizationId: string, memberId: string, d: SaveConnectionInput) {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { lastSalesforceOrgId: true } })
  const orgChanged = !!org?.lastSalesforceOrgId && org.lastSalesforceOrgId !== d.sfOrgId
  const fields = {
    instanceUrl: d.instanceUrl, loginHost: d.loginHost, sfOrgId: d.sfOrgId, sfUserId: d.sfUserId,
    sfUsername: d.sfUsername, sfUserEmail: d.sfUserEmail, refreshTokenEnc: encryptToken(d.refreshToken),
    status: 'CONNECTED' as const, lastError: null, rateLimitedUntil: null, connectedAt: new Date(),
    connectedByMemberId: memberId,
  }
  await prisma.$transaction(async (tx) => {
    if (orgChanged) await tx.lead.updateMany({ where: { organizationId }, data: CLEARED_LEAD_LINK })
    await tx.salesforceConnection.upsert({ where: { organizationId }, create: { organizationId, ...fields }, update: fields })
    await tx.organization.update({ where: { id: organizationId }, data: { lastSalesforceOrgId: d.sfOrgId } })
  })
  tokenCache.delete(organizationId)
  return { orgChanged }
}

export async function deleteConnection(organizationId: string): Promise<void> {
  tokenCache.delete(organizationId)
  await prisma.salesforceConnection.deleteMany({ where: { organizationId } })
}

export function invalidateAccessToken(organizationId: string): void {
  tokenCache.delete(organizationId)
}

export async function getAccessToken(organizationId: string): Promise<{ accessToken: string; instanceUrl: string }> {
  const conn = await getConnection(organizationId)
  if (!conn) {
    tokenCache.delete(organizationId)
    throw new SalesforceAuthError('Salesforce is not connected.')
  }

  const cached = tokenCache.get(organizationId)
  if (cached && cached.refreshTokenEnc === conn.refreshTokenEnc && Date.now() - cached.at < TOKEN_TTL_MS) {
    return { accessToken: cached.accessToken, instanceUrl: cached.instanceUrl }
  }

  try {
    const t = await refreshAccessToken(conn.loginHost, decryptToken(conn.refreshTokenEnc))
    const entry: TokenCacheEntry = {
      accessToken: t.accessToken,
      instanceUrl: t.instanceUrl || conn.instanceUrl,
      refreshTokenEnc: conn.refreshTokenEnc,
      at: Date.now(),
    }
    tokenCache.set(organizationId, entry)
    return { accessToken: entry.accessToken, instanceUrl: entry.instanceUrl }
  } catch (err) {
    if (err instanceof SalesforceAuthError) await markNeedsReconnect(organizationId, err.message)
    throw err
  }
}

export async function markNeedsReconnect(organizationId: string, message: string): Promise<void> {
  tokenCache.delete(organizationId)
  const res = await prisma.salesforceConnection.updateMany({
    where: { organizationId, status: { not: 'NEEDS_RECONNECT' } },
    data: { status: 'NEEDS_RECONNECT', lastError: message },
  })
  if (res.count === 1) {
    await sendOrgAlert(organizationId, 'Salesforce disconnected',
      `Outwyn lost access to Salesforce (${message}).\n\nActivity logging is paused, and emails to leads without a Salesforce check in the last 7 days are held until an admin reconnects in Settings → Salesforce.`)
  }
}

export async function markRateLimited(organizationId: string, until: Date): Promise<void> {
  const res = await prisma.salesforceConnection.updateMany({
    where: { organizationId, status: 'CONNECTED' },
    data: { status: 'RATE_LIMITED', rateLimitedUntil: until },
  })
  if (res.count === 1) {
    await sendOrgAlert(organizationId, 'Salesforce API limit reached',
      `Your Salesforce org has used 80% of today's API calls, so Outwyn paused its Salesforce work until ${until.toISOString()}.\n\nSends to leads with a recent Salesforce check continue.`)
  }
}

export async function releaseExpiredRateLimits(now: Date = new Date()): Promise<void> {
  await prisma.salesforceConnection.updateMany({
    where: { status: 'RATE_LIMITED', rateLimitedUntil: { lte: now } },
    data: { status: 'CONNECTED', rateLimitedUntil: null },
  })
}

export function isSalesforceActive(conn: Pick<SalesforceConnection, 'status' | 'rateLimitedUntil'>, now: Date = new Date()): boolean {
  if (conn.status === 'CONNECTED') return true
  if (conn.status === 'RATE_LIMITED') return !!conn.rateLimitedUntil && conn.rateLimitedUntil <= now
  return false
}
