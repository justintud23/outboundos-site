import type { BusinessProfileDTO, LeadFacts, PropertyTier } from './types'

// One place to tune scoring after the first campaigns.
export const SCORE_WEIGHTS = {
  area: { in: 30, edge: 15, unknown: 10, outCap: 15 },
  edgeFactor: 1.25,
  property: { great: 25, good: 15, unknown: 8, noGoCap: 10 },
  size: { big: 15, some: 5 },
  title: { decision: 15, junior: -10, other: 5 },
  relationship: { past_customer: 15, lost_quote: 10 },
  aiBand: 15,
} as const

export type ScoreSignal = 'area' | 'property' | 'size' | 'title' | 'relationship' | 'ai'
export interface ScorePart { signal: ScoreSignal; label: string; points: number }
export interface RulesScore { rulesScore: number; cap: number | null; parts: ScorePart[]; distanceMiles: number | null }
export type NearestYardFn = (zip: string) => { miles: number; radiusMiles: number } | null

// Per-signal explanation of a profile-scored lead's final `score` — persisted
// to `Lead.scoreBreakdown` so the UI can show why a lead scored the way it did.
export interface ScoreBreakdown {
  parts: ScorePart[]
  rulesScore: number
  cap: number | null
  aiAdjustment: number | null
  aiReason: string | null
}

const FIT_TIER_ORDER: Extract<PropertyTier, 'great' | 'good'>[] = ['great', 'good']
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const fmt = (n: number) => String(Math.round(n * 10) / 10)

// Case-insensitive keyword match, bounded by non-letter/non-digit characters
// on both sides, with an optional plural suffix ('s' or 'es'). Prevents a short
// keyword like 'intern' from matching inside an unrelated word like
// "International" while still matching plurals like "Property Managers".
export function matchesKeyword(text: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?:s|es)?(?![\\p{L}\\p{N}])`, 'iu')
  return re.test(text)
}

export function scoreLeadByRules(
  input: { facts: LeadFacts; title: string | null },
  profile: BusinessProfileDTO,
  nearestYard: NearestYardFn,
): RulesScore {
  const { facts } = input
  const W = SCORE_WEIGHTS
  const parts: ScorePart[] = []
  const caps: number[] = []
  let distanceMiles: number | null = null

  // Area
  if (!facts.zip) {
    parts.push({ signal: 'area', label: 'Area unknown (no ZIP)', points: W.area.unknown })
  } else if (profile.neverZips.includes(facts.zip)) {
    parts.push({ signal: 'area', label: 'Out of area (never-serve ZIP)', points: 0 })
    caps.push(W.area.outCap)
  } else if (profile.alwaysZips.includes(facts.zip)) {
    parts.push({ signal: 'area', label: 'In area (always-serve ZIP)', points: W.area.in })
  } else {
    const near = nearestYard(facts.zip)
    if (!near) {
      parts.push({ signal: 'area', label: 'Area unknown (ZIP not recognized)', points: W.area.unknown })
    } else {
      distanceMiles = Math.round(near.miles)
      const miles = fmt(near.miles)
      if (near.miles <= near.radiusMiles) parts.push({ signal: 'area', label: `In area (${miles} mi)`, points: W.area.in })
      else if (near.miles <= near.radiusMiles * W.edgeFactor) parts.push({ signal: 'area', label: `Edge of area (${miles} mi)`, points: W.area.edge })
      else {
        parts.push({ signal: 'area', label: `Out of area (${miles} mi)`, points: 0 })
        caps.push(W.area.outCap)
      }
    }
  }

  // Property type — a great/good keyword match always wins (real-world values
  // co-occur, e.g. "Residential Homeowners Association" contains both an HOA
  // fit keyword and the no-go 'residential home' keyword). The no-go cap only
  // applies when no great/good keyword matches (R-D).
  const typeText = facts.propertyType?.toLowerCase() ?? null
  if (!typeText) {
    parts.push({ signal: 'property', label: 'Property type unknown', points: W.property.unknown })
  } else {
    let matched = false
    for (const tier of FIT_TIER_ORDER) {
      const rule = profile.propertyTypes.find((r) => r.tier === tier && r.keywords.some((k) => matchesKeyword(typeText, k)))
      if (!rule) continue
      matched = true
      parts.push({ signal: 'property', label: `${rule.label} (${tier} fit)`, points: W.property[tier] })
      break
    }
    if (!matched) {
      const noGoRule = profile.propertyTypes.find((r) => r.tier === 'no_go' && r.keywords.some((k) => matchesKeyword(typeText, k)))
      if (noGoRule) {
        parts.push({ signal: 'property', label: `${noGoRule.label} (not a fit)`, points: 0 })
        caps.push(W.property.noGoCap)
        matched = true
      }
    }
    if (!matched) parts.push({ signal: 'property', label: `Property type "${facts.propertyType}" not recognized`, points: W.property.unknown })
  }

  // Size
  const sizeLabel = facts.sites !== null ? `${fmt(facts.sites)} sites` : facts.acres !== null ? `${fmt(facts.acres)} acres` : null
  const big = (facts.sites !== null && facts.sites >= profile.bigSites) || (profile.bigAcres !== null && facts.acres !== null && facts.acres >= profile.bigAcres)
  if (!sizeLabel) parts.push({ signal: 'size', label: 'Size unknown', points: 0 })
  else parts.push({ signal: 'size', label: sizeLabel, points: big ? W.size.big : W.size.some })

  // Title
  const title = input.title?.toLowerCase().trim() ?? ''
  if (!title) parts.push({ signal: 'title', label: 'No title', points: W.title.other })
  else if (profile.downrankTitleKeywords.some((k) => matchesKeyword(title, k))) parts.push({ signal: 'title', label: 'Junior title', points: W.title.junior })
  else if (profile.decisionTitleKeywords.some((k) => matchesKeyword(title, k))) parts.push({ signal: 'title', label: 'Decision-maker title', points: W.title.decision })
  else parts.push({ signal: 'title', label: 'Other title', points: W.title.other })

  // Relationship
  if (facts.relationship === 'past_customer') parts.push({ signal: 'relationship', label: 'Past customer', points: W.relationship.past_customer })
  if (facts.relationship === 'lost_quote') parts.push({ signal: 'relationship', label: 'Lost quote', points: W.relationship.lost_quote })

  const cap = caps.length > 0 ? Math.min(...caps) : null
  const sum = parts.reduce((s, p) => s + p.points, 0)
  return { rulesScore: clamp(Math.min(cap ?? 100, sum), 0, 100), cap, parts, distanceMiles }
}

export function summarizeProfile(profile: BusinessProfileDTO): string {
  const tier = (t: PropertyTier) => profile.propertyTypes.filter((p) => p.tier === t).map((p) => p.label).join(', ') || 'none'
  return [
    `Company: ${profile.companySummary || 'not described'}`,
    `Services: ${profile.services.join(', ') || 'not listed'}`,
    `Great fit: ${tier('great')}`,
    `Good fit: ${tier('good')}`,
    `Not a fit: ${tier('no_go')}`,
    `Decision-maker titles: ${profile.decisionTitleKeywords.join(', ') || 'not listed'}`,
  ].join('\n')
}
