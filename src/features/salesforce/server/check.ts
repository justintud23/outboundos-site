import type { Lead, SalesforceConnection } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { getConnection, isSalesforceActive } from './connection'
import { getSalesforceClient } from './client'
import { lookupByEmails, type SfPerson } from './records'
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

type LookupEntry = { status: SfStatus; detail: string | null; person: SfPerson | null }

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

  // A requested id that findMany doesn't return (wrong org, or deleted
  // between callers loading it and calling us) is never allowed. There's no
  // row to write a hold timestamp to, so it's held in memory only.
  const foundIds = new Set(leads.map((l) => l.id))
  for (const id of leadIds) if (!foundIds.has(id)) result.held.add(id)

  const needsLookup: CheckLead[] = []
  for (const lead of leads) {
    const decision = decideFromStored(lead, now, SF_FRESH_MS)
    if (decision === 'allowed') result.allowed.add(lead.id)
    else if (decision === 'blocked') result.blocked.set(lead.id, blockReason(lead.sfCheckStatus as SfStatus, lead.sfCheckDetail))
    else needsLookup.push(lead)
  }

  if (needsLookup.length > 0) {
    if (isSalesforceActive(conn, now)) {
      const looked = await tryLookup(organizationId, conn, needsLookup)
      if (looked) await decideAndPersist(needsLookup, looked, now, result)
      else await holdOrDecideFromStale(needsLookup, now, result)
    } else {
      await holdOrDecideFromStale(needsLookup, now, result)
    }
  }

  await clearStaleHold(result)
  await maybeAlertHeld(organizationId, conn, result, now)

  return result
}

/**
 * Runs the one batched Salesforce lookup for a call. Only this network call
 * is caught: a failure here is the ordinary "Salesforce is unreachable"
 * case and falls back to the 7-day/hold rule. It is logged once so the
 * cause isn't lost until the held alert fires a day later.
 */
async function tryLookup(
  organizationId: string,
  conn: Pick<SalesforceConnection, 'customerAccountTypes' | 'blockOpenOpportunities'>,
  needsLookup: CheckLead[],
): Promise<Map<string, LookupEntry> | null> {
  try {
    const client = getSalesforceClient(organizationId)
    const rules = { customerAccountTypes: conn.customerAccountTypes, blockOpenOpportunities: conn.blockOpenOpportunities }
    return await lookupByEmails(client, needsLookup.map((l) => l.email), rules)
  } catch (err) {
    console.error(`[salesforce-check] lookup failed for org ${organizationId}:`, err)
    return null
  }
}

/**
 * Decides every lead from the fresh lookup result first, entirely in
 * memory. Only once every decision is settled do we persist. A DB write
 * failure below is a programming/DB error, not a Salesforce error, so it
 * is allowed to propagate — it must never fall back to stale data (which
 * could let a status the lookup just confirmed as blocking through) and it
 * must never re-decide a lead that's already in `result`.
 */
async function decideAndPersist(needsLookup: CheckLead[], looked: Map<string, LookupEntry>, now: Date, result: ClearResult): Promise<void> {
  const decided = needsLookup.map((lead) => ({ lead, check: looked.get(lead.email.toLowerCase()) ?? null }))

  for (const { lead, check } of decided) {
    if (!check) {
      // lookupByEmails guarantees a key per requested email; treat a missing
      // one as inconclusive rather than silently defaulting to allowed.
      result.held.add(lead.id)
    } else if (BLOCKING.has(check.status)) {
      result.blocked.set(lead.id, blockReason(check.status, check.detail))
    } else {
      result.allowed.add(lead.id)
    }
  }

  for (const { lead, check } of decided) {
    if (!check) {
      if (!lead.sfHeldSince) await prisma.lead.update({ where: { id: lead.id }, data: { sfHeldSince: now } })
      continue
    }
    const linkFields =
      !lead.salesforceId && check.person
        ? { salesforceId: check.person.id, salesforceType: check.person.type, salesforceAccountId: check.person.accountId }
        : {}
    await prisma.lead.update({
      where: { id: lead.id },
      data: { sfCheckStatus: check.status, sfCheckDetail: check.detail, sfCheckedAt: now, ...linkFields },
    })
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

/**
 * Clears `sfHeldSince` for every lead this call just decided (allowed or
 * blocked), however it was decided — by override, by stored data, or by a
 * fresh lookup — so a lead that stops being held doesn't keep counting
 * toward the held alert. One batched write; a lead without a hold to clear
 * is filtered out by the where clause, so this is a no-op for it.
 */
async function clearStaleHold(result: ClearResult): Promise<void> {
  const decidedIds = [...result.allowed, ...result.blocked.keys()]
  if (decidedIds.length === 0) return
  await prisma.lead.updateMany({ where: { id: { in: decidedIds }, sfHeldSince: { not: null } }, data: { sfHeldSince: null } })
}

async function maybeAlertHeld(organizationId: string, conn: SalesforceConnection, result: ClearResult, now: Date): Promise<void> {
  if (result.held.size === 0) return

  try {
    const cutoff = new Date(now.getTime() - SF_FRESH_MS)
    const staleHeldCount = await prisma.lead.count({ where: { organizationId, sfHeldSince: { lt: cutoff } } })
    if (staleHeldCount === 0) return

    if (conn.heldAlertedAt && conn.heldAlertedAt >= cutoff) return

    const sent = await sendOrgAlert(
      organizationId,
      'Salesforce checks are holding emails',
      `${staleHeldCount} lead${staleHeldCount === 1 ? '' : 's'} have been held for more than 24 hours because their Salesforce check keeps failing.\n\nSending resumes automatically once Salesforce is reachable again. An admin can check the connection in Settings, Salesforce.`,
    )
    if (sent) await prisma.salesforceConnection.update({ where: { organizationId }, data: { heldAlertedAt: now } })
  } catch (err) {
    console.error(`[salesforce-check] held alert failed for org ${organizationId}:`, err)
  }
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
      // A draft with no SENT outbound message is unsent, even if this same
      // call is about to cancel a still-QUEUED message for it below.
      where: { organizationId, leadId, status: { in: ['PENDING_REVIEW', 'APPROVED'] }, outboundMessages: { none: { status: 'SENT' } } },
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
