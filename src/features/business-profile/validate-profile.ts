import type { BusinessProfileDTO, ColumnMapping, PresetId, PropertyTier, PropertyTypeRule, Yard } from './types'
import { normalizeColumnKey } from './lead-facts'

type Result = { ok: true; value: BusinessProfileDTO } | { ok: false; error: string }

const PRESET_IDS: PresetId[] = ['snow_paving', 'blank']
const TIERS: PropertyTier[] = ['great', 'good', 'no_go']
const MAPPING_KEYS: (keyof ColumnMapping)[] = ['propertyType', 'zip', 'city', 'state', 'sites', 'acres', 'relationship']
const ZIP = /^\d{5}$/

class Invalid extends Error {}

function list(value: unknown, name: string, max: number, maxLen = 80): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Invalid(`${name} must be a list`)
  const out = [...new Set(value.filter((v): v is string => typeof v === 'string').map((v) => v.trim().toLowerCase()).filter(Boolean))]
  if (out.length > max) throw new Invalid(`${name}: at most ${max} entries`)
  if (out.some((v) => v.length > maxLen)) throw new Invalid(`${name}: each entry at most ${maxLen} characters`)
  return out
}

function zips(value: unknown, name: string): string[] {
  const out = list(value, name, 500, 5)
  if (out.some((z) => !ZIP.test(z))) throw new Invalid(`${name}: use 5-digit ZIP codes`)
  return out
}

export function validateProfile(input: unknown, zipExists: (zip: string) => boolean): Result {
  try {
    if (!input || typeof input !== 'object') throw new Invalid('Invalid profile')
    const o = input as Record<string, unknown>

    if (!PRESET_IDS.includes(o.preset as PresetId)) throw new Invalid('Unknown preset')
    const companySummary = typeof o.companySummary === 'string' ? o.companySummary.trim() : ''
    if (companySummary.length > 600) throw new Invalid('Company summary: at most 600 characters')

    if (!Array.isArray(o.yards) || o.yards.length === 0) throw new Invalid('Add at least one yard (ZIP and radius)')
    if (o.yards.length > 5) throw new Invalid('Use at most 5 yards')
    const yards: Yard[] = o.yards.map((raw, i) => {
      const y = (raw ?? {}) as Record<string, unknown>
      const zip = typeof y.zip === 'string' ? y.zip.trim() : String(y.zip ?? '')
      if (!ZIP.test(zip) || !zipExists(zip)) throw new Invalid(`Yard ${i + 1}: ZIP ${zip || '(blank)'} isn't a known US ZIP code`)
      const radius = Number(y.radiusMiles)
      if (!Number.isFinite(radius) || radius < 1 || radius > 200) throw new Invalid(`Yard ${i + 1}: radius must be 1–200 miles`)
      const label = typeof y.label === 'string' && y.label.trim() ? y.label.trim().slice(0, 40) : `Yard ${i + 1}`
      return { label, zip, radiusMiles: Math.round(radius) }
    })

    const rawTypes = o.propertyTypes === undefined ? [] : o.propertyTypes
    if (!Array.isArray(rawTypes) || rawTypes.length > 30) throw new Invalid('Property types: at most 30')
    const propertyTypes: PropertyTypeRule[] = rawTypes.map((raw, i) => {
      const t = (raw ?? {}) as Record<string, unknown>
      if (!TIERS.includes(t.tier as PropertyTier)) throw new Invalid(`Property type ${i + 1}: unknown tier`)
      const label = typeof t.label === 'string' ? t.label.trim().slice(0, 40) : ''
      if (!label) throw new Invalid(`Property type ${i + 1}: add a name`)
      const keywords = list(t.keywords, `Property type "${label}" keywords`, 20, 40)
      if (keywords.length === 0) throw new Invalid(`Property type "${label}": add at least one keyword`)
      return { label, keywords, tier: t.tier as PropertyTier }
    })

    const bigSites = Number(o.bigSites)
    if (!Number.isInteger(bigSites) || bigSites < 1 || bigSites > 1000) throw new Invalid('Big-customer sites must be a whole number 1–1000')
    const bigAcres = o.bigAcres === null || o.bigAcres === undefined || o.bigAcres === '' ? null : Number(o.bigAcres)
    if (bigAcres !== null && (!Number.isFinite(bigAcres) || bigAcres < 0.1 || bigAcres > 10000)) throw new Invalid('Big-customer acres must be 0.1–10000')

    const rawMapping = o.columnMapping && typeof o.columnMapping === 'object' ? (o.columnMapping as Record<string, unknown>) : {}
    const columnMapping: ColumnMapping = {}
    for (const key of MAPPING_KEYS) {
      const v = rawMapping[key]
      if (typeof v === 'string' && v.trim()) columnMapping[key] = normalizeColumnKey(v).slice(0, 60)
    }

    return {
      ok: true,
      value: {
        preset: o.preset as PresetId,
        companySummary,
        services: list(o.services, 'Services', 20, 60),
        yards,
        alwaysZips: zips(o.alwaysZips, 'Always-serve ZIPs'),
        neverZips: zips(o.neverZips, 'Never-serve ZIPs'),
        propertyTypes,
        decisionTitleKeywords: list(o.decisionTitleKeywords, 'Decision-maker titles', 50),
        downrankTitleKeywords: list(o.downrankTitleKeywords, 'Junior titles', 50),
        bigSites,
        bigAcres,
        columnMapping,
      },
    }
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: err.message }
    throw err
  }
}
