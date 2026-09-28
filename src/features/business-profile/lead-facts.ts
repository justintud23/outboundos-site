import type { ColumnMapping, LeadFacts, Relationship } from './types'

type Field = keyof ColumnMapping

const ALIASES: Record<Field, string[]> = {
  zip: ['zip', 'zip_code', 'zipcode', 'postal_code', 'postcode', 'property_zip'],
  city: ['city', 'property_city', 'town'],
  state: ['state', 'province', 'property_state'],
  propertyType: ['property_type', 'type', 'segment', 'account_type', 'industry'],
  sites: ['sites', 'number_of_sites', 'locations', 'properties', 'property_count', 'num_properties'],
  acres: ['acres', 'lot_size', 'lot_acres'],
  relationship: ['relationship', 'status', 'customer_status', 'lead_type'],
}
const ADDRESS_KEYS = ['property_address', 'address', 'street_address']

/** Same normalization the CSV import applies to headers. */
export function normalizeColumnKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_')
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return null
  const t = value.trim()
  return t ? t : null
}

function pick(custom: Record<string, unknown>, field: Field, mapping: ColumnMapping): string | null {
  const mapped = mapping[field]
  if (mapped) {
    const v = text(custom[normalizeColumnKey(mapped)])
    if (v) return v
  }
  for (const key of ALIASES[field]) {
    const v = text(custom[key])
    if (v) return v
  }
  return null
}

function toZip(raw: string | null): string | null {
  if (!raw) return null
  const five = raw.match(/\b(\d{5})(?:-\d{4})?\b/)
  if (five) return five[1]!
  // ZIP+4 with no separating dash: 142061234 → 14206.
  if (/^\d{9}$/.test(raw)) return raw.slice(0, 5)
  // Excel strips leading zeros from New England ZIPs: 2108 → 02108, including
  // when followed by a ZIP+4 suffix: 2108-1234 → 02108.
  const shortWithSuffix = raw.match(/^(\d{3,4})-\d{4}$/)
  if (shortWithSuffix) return shortWithSuffix[1]!.padStart(5, '0')
  if (/^\d{3,4}$/.test(raw)) return raw.padStart(5, '0')
  return null
}

function zipFromAddress(custom: Record<string, unknown>): string | null {
  for (const key of ADDRESS_KEYS) {
    const v = text(custom[key])
    if (!v) continue
    const all = [...v.matchAll(/\b(\d{5})(?:-\d{4})?\b/g)]
    const last = all[all.length - 1]
    if (last) return last[1]!
  }
  return null
}

function toNumber(raw: string | null): number | null {
  if (!raw) return null
  const m = raw.replace(/,/g, '').match(/\d+(?:\.\d+)?/)
  return m ? Number(m[0]) : null
}

function toRelationship(raw: string | null): Relationship | null {
  if (!raw) return null
  const t = raw.toLowerCase()
  if (/\b(lost|quote|quoted)\b/.test(t)) return 'lost_quote'
  if (/\b(customer|client)\b/.test(t)) return 'past_customer'
  return 'prospect'
}

export function readLeadFacts(customFields: unknown, mapping: ColumnMapping = {}): LeadFacts {
  const custom = asRecord(customFields)
  return {
    zip: toZip(pick(custom, 'zip', mapping)) ?? zipFromAddress(custom),
    city: pick(custom, 'city', mapping),
    state: pick(custom, 'state', mapping),
    propertyType: pick(custom, 'propertyType', mapping),
    sites: toNumber(pick(custom, 'sites', mapping)),
    acres: toNumber(pick(custom, 'acres', mapping)),
    relationship: toRelationship(pick(custom, 'relationship', mapping)),
  }
}

/** Adds {propertyType}, {city}, {sites} merge fields; real CSV columns win. */
export function templateLeadWithFacts<T extends { customFields?: unknown }>(lead: T, facts: LeadFacts): T {
  const derived: Record<string, string> = {}
  if (facts.propertyType) derived.propertyType = facts.propertyType
  if (facts.city) derived.city = facts.city
  if (facts.sites !== null) derived.sites = String(facts.sites)
  return { ...lead, customFields: { ...derived, ...asRecord(lead.customFields) } }
}
