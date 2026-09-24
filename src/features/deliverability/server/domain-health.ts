import type { DomainHealth, DomainStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { evaluateDomain, type DomainCheck } from '../evaluate-domain'
import { lookupDomainRecords, DnsLookupError } from './lookup-domain'
import { fetchRegistrationDate } from './rdap'

export const RECHECK_MIN_INTERVAL_MS = 60_000

export type CheckDeps = {
  lookup?: typeof lookupDomainRecords
  rdap?: typeof fetchRegistrationDate
  now?: () => Date
}

export function domainOf(email: string): string {
  return (email.split('@')[1] ?? '').trim().toLowerCase()
}

/** Create UNVERIFIED rows for new Graph mailbox domains; return never-attempted rows. */
export async function ensureDomainRows(organizationId: string): Promise<{ id: string; domain: string }[]> {
  const mailboxes = await prisma.mailbox.findMany({
    where: { organizationId, provider: 'MICROSOFT_GRAPH' },
    select: { email: true },
  })
  const domains = [...new Set(mailboxes.map((m) => domainOf(m.email)).filter(Boolean))]
  if (domains.length > 0) {
    await prisma.domainHealth.createMany({
      data: domains.map((domain) => ({ organizationId, domain })),
      skipDuplicates: true,
    })
  }
  return prisma.domainHealth.findMany({
    where: { organizationId, lastAttemptAt: null },
    select: { id: true, domain: true },
  })
}

function fixesText(checks: DomainCheck[]): string {
  return checks
    .filter((c) => c.result === 'fail')
    .map((c) => `• ${c.record}: ${c.fix ?? 'see the Deliverability page'}`)
    .join('\n')
}

async function maybeAlert(row: DomainHealth): Promise<void> {
  const checks = (row.checks as unknown as DomainCheck[] | null) ?? []
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  if (row.status === 'FAILING' && row.alertedStatus !== 'FAILING') {
    const ok = await sendOrgAlert(
      row.organizationId,
      `Domain ${row.domain} is failing — sending from it is paused`,
      `Mail from ${row.domain} is on hold until these DNS problems are fixed:\n\n${fixesText(checks)}\n\nAfter fixing, click "Recheck now" on ${appUrl}/deliverability. Queued emails will go out once it passes.`,
    )
    if (ok) await prisma.domainHealth.update({ where: { id: row.id }, data: { alertedStatus: 'FAILING' } })
  } else if ((row.status === 'HEALTHY' || row.status === 'WARNING') && row.alertedStatus === 'FAILING') {
    const ok = await sendOrgAlert(
      row.organizationId,
      `Domain ${row.domain} has recovered`,
      `${row.domain} passes its DNS checks again. Sending from its mailboxes has resumed.`,
    )
    if (ok) await prisma.domainHealth.update({ where: { id: row.id }, data: { alertedStatus: row.status } })
  }
}

export async function checkDomain(id: string, deps: CheckDeps = {}): Promise<DomainHealth> {
  const lookup = deps.lookup ?? lookupDomainRecords
  const rdap = deps.rdap ?? fetchRegistrationDate
  const now = (deps.now ?? (() => new Date()))()

  const row = await prisma.domainHealth.findUnique({ where: { id } })
  if (!row) throw new Error(`DomainHealth ${id} not found`)

  // Registration date: look it up only while unknown; a manual date always wins.
  const registration: Prisma.DomainHealthUpdateInput = {}
  if (!row.registeredAt && row.registeredAtSource !== 'manual') {
    const registeredAt = await rdap(row.domain)
    if (registeredAt) Object.assign(registration, { registeredAt, registeredAtSource: 'rdap' })
  }

  let records
  try {
    records = await lookup(row.domain)
  } catch (err) {
    if (!(err instanceof DnsLookupError)) throw err
    // Couldn't check: keep status/checks (UNVERIFIED stays blocking), no alert.
    return prisma.domainHealth.update({
      where: { id },
      data: { ...registration, lastAttemptAt: now, lastError: `Couldn't check DNS (${err.code}). Will retry.` },
    })
  }

  const { status, checks } = evaluateDomain(row.domain, records)
  const updated = await prisma.domainHealth.update({
    where: { id },
    data: {
      ...registration,
      status: status as DomainStatus,
      checks: checks as unknown as Prisma.InputJsonValue,
      lastCheckedAt: now,
      lastAttemptAt: now,
      lastError: null,
      ...(status !== row.status && { lastStatusChangeAt: now }),
    },
  })
  await maybeAlert(updated)
  return updated
}

/** Daily: make sure every connected org's domains have rows, then check oldest first. */
export async function refreshAllDomains(budgetMs = 25_000, deps: CheckDeps = {}): Promise<{ checked: number; failed: number }> {
  const startedAt = Date.now()
  const orgs = await prisma.organization.findMany({ where: { msTenantId: { not: null } }, select: { id: true } })
  for (const org of orgs) await ensureDomainRows(org.id)

  const rows = await prisma.domainHealth.findMany({
    orderBy: { lastAttemptAt: { sort: 'asc', nulls: 'first' } },
    select: { id: true },
  })
  let checked = 0
  let failed = 0
  for (const { id } of rows) {
    if (Date.now() - startedAt > budgetMs) break
    try {
      await checkDomain(id, deps)
      checked++
    } catch (err) {
      failed++
      console.error(`[domain-health] check ${id} failed`, err)
    }
  }
  return { checked, failed }
}

export async function getDomainHealthMap(
  organizationId: string,
): Promise<Map<string, { status: DomainStatus; registeredAt: Date | null }>> {
  const rows = await prisma.domainHealth.findMany({
    where: { organizationId },
    select: { domain: true, status: true, registeredAt: true },
  })
  return new Map(rows.map((r) => [r.domain, { status: r.status, registeredAt: r.registeredAt }]))
}
