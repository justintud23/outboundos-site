import { prisma } from '@/lib/db/prisma'
import { ensureDomainRows, checkDomain } from '@/features/deliverability/server/domain-health'

export const DEFAULT_GRAPH_DAILY_LIMIT = 30
export const CONNECT_STATE_COOKIE = 'ms_connect_state'
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Builds the Microsoft admin-consent URL an org admin visits to grant our
 * Azure app tenant-wide, app-only Graph access. `state` is echoed back on the
 * callback and must be verified against the httpOnly cookie set alongside it.
 */
export function buildAdminConsentUrl(state: string): string {
  const clientId = process.env.MS_GRAPH_CLIENT_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  if (!clientId || !appUrl) throw new Error('MS_GRAPH_CLIENT_ID and NEXT_PUBLIC_APP_URL must be set')
  const url = new URL('https://login.microsoftonline.com/organizations/v2.0/adminconsent')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', 'https://graph.microsoft.com/.default')
  url.searchParams.set('redirect_uri', `${appUrl}/api/integrations/microsoft/callback`)
  url.searchParams.set('state', state)
  return url.toString()
}

export class TenantMismatchError extends Error {
  constructor(public readonly tenantId: string) {
    super(`Tenant ${tenantId} is not the Microsoft 365 tenant this deployment is configured for (MS_GRAPH_TENANT_ID).`)
    this.name = 'TenantMismatchError'
    Object.setPrototypeOf(this, TenantMismatchError.prototype)
  }
}

/**
 * The admin-consent callback's `tenant` parameter is user-controllable, so it
 * is never trusted on its own: it must equal the tenant pinned in
 * MS_GRAPH_TENANT_ID (case-insensitive). Without the pin, connecting is
 * refused outright.
 */
function assertPinnedTenant(tenantId: string): void {
  const pinned = process.env.MS_GRAPH_TENANT_ID?.trim()
  if (!pinned) throw new Error('MS_GRAPH_TENANT_ID must be set to connect Microsoft 365')
  if (tenantId.toLowerCase() !== pinned.toLowerCase()) throw new TenantMismatchError(tenantId)
}

export async function saveTenant(organizationId: string, tenantId: string): Promise<void> {
  if (!GUID.test(tenantId)) throw new Error(`Invalid tenant id: ${tenantId}`)
  assertPinnedTenant(tenantId)
  await prisma.organization.update({
    where: { id: organizationId },
    // Reconnecting is how a human clears an auth-failure pause.
    data: { msTenantId: tenantId, sendingPaused: false, pausedReason: null },
  })
}

export async function importGraphMailboxes(
  organizationId: string,
  users: { id: string; email: string; displayName: string }[],
): Promise<{ created: number }> {
  const res = await prisma.mailbox.createMany({
    data: users.map((u) => ({
      organizationId,
      email: u.email.trim().toLowerCase(),
      displayName: u.displayName.trim() || u.email,
      provider: 'MICROSOFT_GRAPH' as const,
      graphUserId: u.id,
      dailyLimit: DEFAULT_GRAPH_DAILY_LIMIT,
      warmupEnabled: true,
      warmupStartedAt: new Date(),
    })),
    skipDuplicates: true,
  })
  // New sending domains are checked right away so they aren't blocked (as
  // UNVERIFIED) until the next daily run. Best-effort: DNS trouble never
  // fails the import.
  const fresh = await ensureDomainRows(organizationId)
  await Promise.allSettled(fresh.map((row) => checkDomain(row.id)))
  return { created: res.count }
}
