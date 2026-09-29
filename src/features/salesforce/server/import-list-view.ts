import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { normalizeCountry } from '@/features/leads/canada'
import { chunk, getSalesforceClient, type SfClient } from './client'
import { fetchPeople, lookupByEmails, type SfPerson } from './records'
import { getConnection } from './connection'
import { SalesforceAuthError } from './errors'
import { classifySfRecord, mostRestrictive, BLOCKING, SKIP_KEY, type ClassifyRules, type SfStatus } from '../classify'

export const MAX_SF_IMPORT = 2000
export const PREVIEW_ROWS = 25
const LIST_VIEW_PAGE_SIZE = 200

export type SfObjectName = 'Lead' | 'Contact'

export interface SfImportResult {
  batchId: string
  imported: number
  linked: number
  skipped: { customer: number; openOpportunity: number; optedOut: number; converted: number; noEmail: number; invalid: number }
  leadIds: string[]
}

interface ImportListViewInput {
  organizationId: string
  memberId: string
  object: SfObjectName
  listViewId: string
  listViewLabel: string
  useSalesforceOwners: boolean
}

const EXISTING_LEAD_SELECT = {
  id: true,
  email: true,
  salesforceId: true,
  firstName: true,
  lastName: true,
  company: true,
  title: true,
  phone: true,
  country: true,
  customFields: true,
} as const

/** Every id a list view returns, paged 200 at a time and capped at MAX_SF_IMPORT. */
async function collectIds(client: SfClient, object: SfObjectName, listViewId: string): Promise<string[]> {
  const ids: string[] = []
  let offset = 0
  for (;;) {
    const page = await client.listViewIds(object, listViewId, { limit: LIST_VIEW_PAGE_SIZE, offset })
    ids.push(...page.ids)
    offset += LIST_VIEW_PAGE_SIZE
    if (page.ids.length === 0) break
    if (ids.length >= page.size) break
    if (ids.length >= MAX_SF_IMPORT) break
  }
  return ids.slice(0, MAX_SF_IMPORT)
}

function cfObject(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Only fills a currently-null field; never overwrites an existing value. */
function fillField(existing: string | null, incoming: string | null): string | undefined {
  return existing == null && incoming != null ? incoming : undefined
}

function personName(p: SfPerson): string {
  const full = [p.firstName, p.lastName].filter(Boolean).join(' ').trim()
  return full || p.email || ''
}

/**
 * A list view can return two Salesforce records that share an email (e.g. a
 * Contact and a Lead, or two Contacts) — pick the one to link/create from: a
 * Contact when the group has one, else the first Lead.
 */
function pickRepresentative(records: SfPerson[]): SfPerson {
  const contact = records.find((r) => r.type === 'CONTACT')
  if (contact) return contact
  const lead = records.find((r) => r.type === 'LEAD')
  if (lead) return lead
  return records[0] as SfPerson // records is always non-empty by construction
}

const EXISTING_LEAD_CHUNK = 200

/**
 * Existing org leads whose email matches one of `emails` (already lower-cased)
 * ignoring case. CSV imports keep the email's original case and the unique
 * index is case-sensitive, so an exact match would miss `Jane@Acme.com` and
 * create a duplicate. The database match is case-insensitive; the result is
 * then filtered to exact lower-cased equality so a looser database match
 * (e.g. ILIKE treating `_` as a wildcard) can never link the wrong lead.
 */
async function findExistingLeads(organizationId: string, emails: string[]) {
  const wanted = new Set(emails)
  const leads = []
  for (const part of chunk(emails, EXISTING_LEAD_CHUNK)) {
    leads.push(
      ...(await prisma.lead.findMany({
        where: { organizationId, OR: part.map((e) => ({ email: { equals: e, mode: 'insensitive' as const } })) },
        select: EXISTING_LEAD_SELECT,
      })),
    )
  }
  return leads.filter((l) => wanted.has(l.email.toLowerCase()))
}

export async function listListViews(organizationId: string, object: SfObjectName): Promise<{ id: string; label: string }[]> {
  const client = getSalesforceClient(organizationId)
  return client.listViews(object)
}

export async function previewListView({
  organizationId,
  object,
  listViewId,
}: {
  organizationId: string
  object: SfObjectName
  listViewId: string
}): Promise<{ total: number; rows: { id: string; name: string; email: string | null; company: string | null; title: string | null }[] }> {
  const client = getSalesforceClient(organizationId)
  const { ids, size } = await client.listViewIds(object, listViewId, { limit: PREVIEW_ROWS, offset: 0 })
  const people = await fetchPeople(client, object, { ids })

  // SOQL's `WHERE Id IN (...)` doesn't promise result order matches the
  // list view's own ordering, so re-sort by the id list the list view gave us.
  const byId = new Map(people.map((p) => [p.id, p]))
  const rows = ids
    .map((id) => byId.get(id))
    .filter((p): p is SfPerson => !!p)
    .map((p) => ({ id: p.id, name: personName(p), email: p.email, company: p.company, title: p.title }))

  return { total: size, rows }
}

export async function importListView({
  organizationId,
  memberId,
  object,
  listViewId,
  listViewLabel,
  useSalesforceOwners,
}: ImportListViewInput): Promise<SfImportResult> {
  const conn = await getConnection(organizationId)
  if (!conn) throw new SalesforceAuthError('Salesforce is not connected.')
  const rules: ClassifyRules = { customerAccountTypes: conn.customerAccountTypes, blockOpenOpportunities: conn.blockOpenOpportunities }

  const client = getSalesforceClient(organizationId)
  const ids = await collectIds(client, object, listViewId)
  const people = await fetchPeople(client, object, { ids })
  const now = new Date()

  const skipped = { customer: 0, openOpportunity: 0, optedOut: 0, converted: 0, noEmail: 0, invalid: 0 }
  const blockedMap = new Map<string, { status: SfStatus; detail: string | null; person: SfPerson }>()

  // Group by lower-cased email first: a list view can return two records
  // (e.g. a Contact and a Lead) for the same person, and if one is blocking
  // while the other is clear, the pair must be decided together — otherwise
  // the clear record alone would import/link a person Salesforce blocks.
  const groups = new Map<string, SfPerson[]>()
  for (const p of people) {
    const email = p.email
    if (!email) {
      skipped.noEmail++
      continue
    }
    if (!z.string().email().safeParse(email).success) {
      skipped.invalid++
      continue
    }
    const key = email.toLowerCase()
    const group = groups.get(key)
    if (group) group.push(p)
    else groups.set(key, [p])
  }

  // The list view only returns one object type (Leads or Contacts), so a
  // person who looks clear there can still be blocked elsewhere in Salesforce
  // (e.g. a Contact on a customer Account). Run the same cross-object lookup
  // the send-time check uses over every email, and decide each email by the
  // most restrictive of the list-view records and the lookup. That combined
  // result is what gets stored, so the stored check is as good as a send-time
  // one. A lookup failure propagates before anything is written.
  const lookup = groups.size > 0 ? await lookupByEmails(client, [...groups.keys()], rules) : new Map<string, { status: SfStatus; detail: string | null }>()

  const clearMap = new Map<string, { status: SfStatus; detail: string | null; person: SfPerson }>()
  for (const [email, records] of groups) {
    const looked = lookup.get(email)
    const combined = mostRestrictive([
      ...records.map((r) => classifySfRecord(r, rules)),
      ...(looked ? [{ status: looked.status, detail: looked.detail }] : []),
    ])
    const rep = pickRepresentative(records)
    if (BLOCKING.has(combined.status)) {
      const key = SKIP_KEY[combined.status]
      if (key) skipped[key]++
      blockedMap.set(email, { status: combined.status, detail: combined.detail, person: rep })
    } else {
      clearMap.set(email, { status: combined.status, detail: combined.detail, person: rep })
    }
  }

  const emails = [...blockedMap.keys(), ...clearMap.keys()]
  const existingLeads = await findExistingLeads(organizationId, emails)

  let linked = 0
  for (const lead of existingLeads) {
    const key = lead.email.toLowerCase()
    const blocked = blockedMap.get(key)
    const entry = blocked ?? clearMap.get(key) ?? null
    if (!entry) continue // every email queried came from blockedMap/clearMap, so this can't happen
    if (!blocked) linked++

    const person = entry.person
    const linkFields = lead.salesforceId == null
      ? { salesforceId: person.id, salesforceType: person.type, salesforceAccountId: person.accountId }
      : {}

    const existingCF = cfObject(lead.customFields)
    const cfPatch: Record<string, unknown> = {}
    if (!('state' in existingCF) && person.state) cfPatch.state = person.state
    if (!('zip' in existingCF) && person.postalCode) cfPatch.zip = person.postalCode
    const customFieldsUpdate =
      Object.keys(cfPatch).length > 0
        ? { customFields: { ...existingCF, ...cfPatch } as Prisma.InputJsonValue }
        : {}

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...linkFields,
        firstName: fillField(lead.firstName, person.firstName),
        lastName: fillField(lead.lastName, person.lastName),
        company: fillField(lead.company, person.company),
        title: fillField(lead.title, person.title),
        phone: fillField(lead.phone, person.phone),
        country: fillField(lead.country, normalizeCountry(person.country)),
        ...customFieldsUpdate,
        sfCheckStatus: entry.status,
        sfCheckDetail: entry.detail,
        sfCheckedAt: now,
      },
    })
  }

  const existingEmails = new Set(existingLeads.map((l) => l.email.toLowerCase()))
  const batch = await prisma.importBatch.create({
    data: { organizationId, fileName: `Salesforce: ${listViewLabel}`, rowCount: people.length, status: 'PROCESSING' },
  })

  const newClearPeople = [...clearMap.entries()].filter(([email]) => !existingEmails.has(email))

  let ownerByEmail: Map<string, string> | null = null
  if (useSalesforceOwners) {
    const members = await prisma.orgMember.findMany({ where: { organizationId }, select: { id: true, email: true } })
    ownerByEmail = new Map(
      members.filter((m): m is typeof m & { email: string } => !!m.email).map((m) => [m.email.toLowerCase(), m.id]),
    )
  }
  const ownerFor = (person: SfPerson): string => {
    const match = person.ownerEmail ? ownerByEmail?.get(person.ownerEmail.toLowerCase()) : undefined
    return match ?? memberId
  }

  const data = newClearPeople.map(([email, { status, detail, person: p }]) => {
    const cf: Record<string, string> = {}
    if (p.state) cf.state = p.state
    if (p.postalCode) cf.zip = p.postalCode
    return {
      organizationId,
      importBatchId: batch.id,
      ownerId: ownerFor(p),
      email,
      firstName: p.firstName,
      lastName: p.lastName,
      company: p.company,
      title: p.title,
      phone: p.phone,
      country: normalizeCountry(p.country),
      customFields: Object.keys(cf).length > 0 ? cf : undefined,
      source: 'SALESFORCE' as const,
      salesforceId: p.id,
      salesforceType: p.type,
      salesforceAccountId: p.accountId,
      sfCheckStatus: status,
      sfCheckDetail: detail,
      sfCheckedAt: now,
    }
  })

  const created = data.length > 0
    ? await prisma.lead.createManyAndReturn({ data, skipDuplicates: true, select: { id: true } })
    : []

  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0)
  await prisma.importBatch.update({
    where: { id: batch.id },
    data: { successCount: created.length + linked, errorCount: skippedTotal, status: 'COMPLETED' },
  })

  return { batchId: batch.id, imported: created.length, linked, skipped, leadIds: created.map((l) => l.id) }
}
