import { prisma } from '@/lib/db/prisma'
import { getSalesforceAppConfig } from '../config'
import { getConnection } from './connection'

export interface SalesforceStatusDTO {
  configured: boolean
  connected: boolean
  status: 'CONNECTED' | 'NEEDS_RECONNECT' | 'RATE_LIMITED' | null
  username: string | null
  instanceUrl: string | null
  /** The OAuth login host the connection was made through; the sandbox host means a sandbox org. */
  loginHost: string | null
  lastError: string | null
  rateLimitedUntil: string | null
  customerAccountTypes: string[]
  blockOpenOpportunities: boolean
  logActivity: boolean
  counts: { synced24h: number; pending: number; failed: number }
  recentFailures: { id: string; type: string; leadEmail: string; lastError: string | null; updatedAt: string }[]
}

export interface SalesforceSettingsPatch {
  customerAccountTypes?: string[]
  blockOpenOpportunities?: boolean
  logActivity?: boolean
}

const NOT_CONNECTED_DEFAULTS = {
  connected: false as const,
  status: null,
  username: null,
  instanceUrl: null,
  loginHost: null,
  lastError: null,
  rateLimitedUntil: null,
  customerAccountTypes: ['Customer'],
  blockOpenOpportunities: true,
  logActivity: true,
  counts: { synced24h: 0, pending: 0, failed: 0 },
  recentFailures: [],
}

export async function getSalesforceStatus(organizationId: string): Promise<SalesforceStatusDTO> {
  const configured = !!getSalesforceAppConfig()
  const conn = await getConnection(organizationId)

  if (!conn) {
    return { configured, ...NOT_CONNECTED_DEFAULTS }
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const [synced24h, pending, failed, recentFailures] = await Promise.all([
    prisma.salesforceSyncJob.count({
      where: { organizationId, status: 'DONE', updatedAt: { gte: since } },
    }),
    prisma.salesforceSyncJob.count({ where: { organizationId, status: 'PENDING' } }),
    prisma.salesforceSyncJob.count({ where: { organizationId, status: 'FAILED' } }),
    prisma.salesforceSyncJob.findMany({
      where: { organizationId, status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { id: true, type: true, lastError: true, updatedAt: true, lead: { select: { email: true } } },
    }),
  ])

  return {
    configured,
    connected: true,
    status: conn.status,
    username: conn.sfUsername,
    instanceUrl: conn.instanceUrl,
    loginHost: conn.loginHost,
    lastError: conn.lastError,
    rateLimitedUntil: conn.rateLimitedUntil ? conn.rateLimitedUntil.toISOString() : null,
    customerAccountTypes: conn.customerAccountTypes,
    blockOpenOpportunities: conn.blockOpenOpportunities,
    logActivity: conn.logActivity,
    counts: { synced24h, pending, failed },
    recentFailures: recentFailures.map((job) => ({
      id: job.id,
      type: job.type,
      leadEmail: job.lead.email,
      lastError: job.lastError,
      updatedAt: job.updatedAt.toISOString(),
    })),
  }
}

/** Returns false when the org has no Salesforce connection row (nothing to update). */
export async function updateSalesforceSettings(
  organizationId: string,
  patch: SalesforceSettingsPatch,
): Promise<boolean> {
  const data: Record<string, unknown> = {}
  if (patch.customerAccountTypes !== undefined) data.customerAccountTypes = patch.customerAccountTypes
  if (patch.blockOpenOpportunities !== undefined) data.blockOpenOpportunities = patch.blockOpenOpportunities
  if (patch.logActivity !== undefined) data.logActivity = patch.logActivity

  // Changing the customer rules makes every cached check stale: a lead
  // checked CLEAR an hour ago may now be blocked. Clearing sfCheckedAt forces
  // a fresh lookup on each lead's next send. Stored statuses stay for
  // display; until that lookup succeeds, the 7-day stale fallback no longer
  // applies to these leads, so they are held if Salesforce is unreachable.
  const rulesChanged = patch.customerAccountTypes !== undefined || patch.blockOpenOpportunities !== undefined

  return prisma.$transaction(async (tx) => {
    const result = await tx.salesforceConnection.updateMany({ where: { organizationId }, data })
    if (result.count !== 1) return false
    if (rulesChanged) await tx.lead.updateMany({ where: { organizationId }, data: { sfCheckedAt: null } })
    return true
  })
}
