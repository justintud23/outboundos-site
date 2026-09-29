import type { Lead, SalesforceConnection } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { getConnection, isSalesforceActive } from './connection'
import { getSalesforceClient } from './client'
import { lookupByEmails } from './records'
import { BLOCKING, blockReason, type SfStatus } from '../classify'

// Pre-send safety check: decides whether OutboundOS may email a lead, per
// spec §5. A cached, recent Salesforce check decides instantly; otherwise
// one batched lookup covers the whole call. If Salesforce is unreachable,
// leads fall back to a stale-but-recent stored result, or are held (paused,
// not blocked) until a check can succeed. Salesforce trouble never blocks
// or crashes a send — only a confirmed blocking status does.

export const SF_FRESH_MS = 24 * 60 * 60 * 1000 // a cached check this recent decides outright
export const SF_STALE_OK_MS = 7 * 24 * 60 * 60 * 1000 // a cached check this recent still decides when Salesforce is unreachable
export const SF_HOLD_MS = 10 * 60 * 1000 // minimum wait before retrying a held send

export interface ClearResult {
  allowed: Set<string>
  held: Set<string>
  blocked: Map<string, string> // leadId -> reason
}

const LEAD_SELECT = {
  id: true,
  organizationId: true,
  email: true,
  salesforceId: true,
  sfCheckStatus: true,
  sfCheckDetail: true,
  sfCheckedAt: true,
  sfBlockOverride: true,
  sfHeldSince: true,
} as const

type CheckLead = Pick<
  Lead,
  'id' | 'organizationId' | 'email' | 'salesforceId' | 'sfCheckStatus' | 'sfCheckDetail' | 'sfCheckedAt' | 'sfBlockOverride' | 'sfHeldSince'
>

/**
 * Decides a lead purely from its stored check, without a fresh lookup.
 * `null` means "no decision" — the caller needs a lookup or must hold.
 */
function decideFromStored(lead: CheckLead, now: Date, maxAgeMs: number): 'allowed' | 'blocked' | null {
  if (lead.sfBlockOverride) return 'allowed'
  if (!lead.sfCheckedAt || now.getTime() - lead.sfCheckedAt.getTime() > maxAgeMs) return null
  if (!lead.sfCheckStatus) return 'allowed' // NOT_FOUND and null both count as clear
  return BLOCKING.has(lead.sfCheckStatus) ? 'blocked' : 'allowed'
}

export async function ensureSalesforceClear(organizationId: string, leadIds: string[], now: Date = new Date()): Promise<ClearResult> {
  const result: ClearResult = { allowed: new Set(), held: new Set(), blocked: new Map() }
  if (leadIds.length === 0) return result

  const conn = await getConnection(organizationId)
  if (!conn) {
    for (const id of leadIds) result.allowed.add(id)
    return result
  }

  const leads = await prisma.lead.findMany({ where: { organizationId, id: { in: leadIds } }, select: LEAD_SELECT })

  const needsLookup: CheckLead[] = []
  for (const lead of leads) {
    const decision = decideFromStored(lead, now, SF_FRESH_MS)
    if (decision === 'allowed') result.allowed.add(lead.id)
    else if (decision === 'blocked') result.blocked.set(lead.id, blockReason(lead.sfCheckStatus as SfStatus, lead.sfCheckDetail))
    else needsLookup.push(lead)
  }

  if (needsLookup.length > 0) {
    if (isSalesforceActive(conn, now)) {
      try {
        await lookupAndDecide(organizationId, conn, needsLookup, now, result)
      } catch {
        await holdOrDecideFromStale(needsLookup, now, result)
      }
    } else {
      await holdOrDecideFromStale(needsLookup, now, result)
    }
  }

  await maybeAlertHeld(organizationId, conn, result, now)

  return result
}

async function lookupAndDecide(
  organizationId: string,
  conn: Pick<SalesforceConnection, 'customerAccountTypes' | 'blockOpenOpportunities'>,
  needsLookup: CheckLead[],
  now: Date,
  result: ClearResult,
): Promise<void> {
  const client = getSalesforceClient(organizationId)
  const rules = { customerAccountTypes: conn.customerAccountTypes, blockOpenOpportunities: conn.blockOpenOpportunities }
  const looked = await lookupByEmails(client, needsLookup.map((l) => l.email), rules)

  for (const lead of needsLookup) {
    const check = looked.get(lead.email.toLowerCase())
    if (!check) {
      // lookupByEmails guarantees a key per requested email; treat a missing
      // one as inconclusive rather than silently defaulting to allowed.
      result.held.add(lead.id)
      if (!lead.sfHeldSince) await prisma.lead.update({ where: { id: lead.id }, data: { sfHeldSince: now } })
      continue
    }

    const linkFields =
      !lead.salesforceId && check.person
        ? { salesforceId: check.person.id, salesforceType: check.person.type, salesforceAccountId: check.person.accountId }
        : {}

    await prisma.lead.update({
      where: { id: lead.id },
      data: { sfCheckStatus: check.status, sfCheckDetail: check.detail, sfCheckedAt: now, sfHeldSince: null, ...linkFields },
    })

    if (BLOCKING.has(check.status)) result.blocked.set(lead.id, blockReason(check.status, check.detail))
    else result.allowed.add(lead.id)
  }
}

async function holdOrDecideFromStale(leads: CheckLead[], now: Date, result: ClearResult): Promise<void> {
  const toHold: string[] = []
  for (const lead of leads) {
    const decision = decideFromStored(lead, now, SF_STALE_OK_MS)
    if (decision === 'allowed') result.allowed.add(lead.id)
    else if (decision === 'blocked') result.blocked.set(lead.id, blockReason(lead.sfCheckStatus as SfStatus, lead.sfCheckDetail))
    else {
      result.held.add(lead.id)
      if (!lead.sfHeldSince) toHold.push(lead.id)
    }
  }
  if (toHold.length > 0) await prisma.lead.updateMany({ where: { id: { in: toHold } }, data: { sfHeldSince: now } })
}

async function maybeAlertHeld(organizationId: string, conn: SalesforceConnection, result: ClearResult, now: Date): Promise<void> {
  if (result.held.size === 0) return

  const cutoff = new Date(now.getTime() - SF_FRESH_MS)
  const staleHeldCount = await prisma.lead.count({ where: { organizationId, sfHeldSince: { lt: cutoff } } })
  if (staleHeldCount === 0) return

  if (conn.heldAlertedAt && conn.heldAlertedAt >= cutoff) return

  await sendOrgAlert(
    organizationId,
    'Salesforce checks are holding emails',
    `${staleHeldCount} lead${staleHeldCount === 1 ? '' : 's'} have been held for more than 24 hours because their Salesforce check keeps failing.\n\nSending resumes automatically once Salesforce is reachable again. An admin can check the connection in Settings, Salesforce.`,
  )
  await prisma.salesforceConnection.update({ where: { organizationId }, data: { heldAlertedAt: now } })
}

export async function applySalesforceBlock(
  organizationId: string,
  leadId: string,
  reason: string,
  opts: { exceptMessageId?: string } = {},
): Promise<void> {
  await prisma.$transaction([
    prisma.sequenceEnrollment.updateMany({
      where: { organizationId, leadId, status: { in: ['ACTIVE', 'PAUSED'] } },
      data: { status: 'STOPPED', stoppedAt: new Date(), stoppedReason: reason, processing: false },
    }),
    prisma.draft.updateMany({
      where: { organizationId, leadId, status: { in: ['PENDING_REVIEW', 'APPROVED'] }, outboundMessages: { none: {} } },
      data: { status: 'BLOCKED' },
    }),
    prisma.outboundMessage.updateMany({
      where: {
        organizationId,
        leadId,
        status: 'QUEUED',
        processing: false,
        ...(opts.exceptMessageId ? { id: { not: opts.exceptMessageId } } : {}),
      },
      data: { status: 'CANCELLED', lastError: reason },
    }),
  ])
  console.info(`[salesforce] blocked lead ${leadId}: ${reason}`)
}

/**
 * Warms the pre-send cache for a batch of leads ahead of time, grouped by
 * org. Best-effort: a failure for one org (or the whole batch) never
 * throws, since this only primes the cache that `ensureSalesforceClear`
 * will consult again at send time.
 */
export async function prefetchSalesforceChecks(leadIds: string[], now: Date = new Date()): Promise<void> {
  if (leadIds.length === 0) return

  let leads: { id: string; organizationId: string }[]
  try {
    leads = await prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, organizationId: true } })
  } catch (err) {
    console.error('[salesforce] prefetch: failed to load leads', err)
    return
  }

  const byOrg = new Map<string, string[]>()
  for (const lead of leads) {
    const ids = byOrg.get(lead.organizationId) ?? []
    ids.push(lead.id)
    byOrg.set(lead.organizationId, ids)
  }

  await Promise.all(
    [...byOrg.entries()].map(async ([organizationId, ids]) => {
      try {
        await ensureSalesforceClear(organizationId, ids, now)
      } catch (err) {
        console.error(`[salesforce] prefetch failed for org ${organizationId}`, err)
      }
    }),
  )
}
