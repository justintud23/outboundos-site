import { describe, it, expect } from 'vitest'
import { scoreLeadByRules, summarizeProfile, matchesKeyword, SCORE_WEIGHTS } from './score-rules'
import { PRESETS } from './presets'
import type { LeadFacts } from './types'

const profile = { ...PRESETS.snow_paving, yards: [{ label: 'Buffalo', zip: '14206', radiusMiles: 20 }], alwaysZips: ['14001'], neverZips: ['14221'] }
const facts = (o: Partial<LeadFacts> = {}): LeadFacts => ({ zip: '14210', city: null, state: null, propertyType: 'HOA', sites: 8, acres: null, relationship: null, ...o })
const at = (miles: number) => (zip: string) => (zip === '99999' ? null : { miles, radiusMiles: 20 })
const score = (f: LeadFacts, title: string | null = 'Property Manager', miles = 10) => scoreLeadByRules({ facts: f, title }, profile, at(miles))

describe('scoreLeadByRules', () => {
  it('scores a perfect in-area HOA property manager with many sites', () => {
    const r = score(facts({ relationship: 'past_customer' }))
    expect(r.rulesScore).toBe(100)
    expect(r.cap).toBeNull()
    expect(r.parts.map((p) => p.label)).toEqual([
      'In area (10 mi)', 'HOA / community association (great fit)', '8 sites', 'Decision-maker title', 'Past customer',
    ])
  })

  it('area bands: edge, out (cap), unknown ZIP, no ZIP, always/never lists (Review Focus #3)', () => {
    expect(score(facts(), null, 24).parts[0]).toMatchObject({ label: 'Edge of area (24 mi)', points: 15 })
    const out = score(facts(), 'Property Manager', 40)
    expect(out.cap).toBe(15)
    expect(out.rulesScore).toBe(15)
    expect(score(facts({ zip: '99999' })).parts[0]).toMatchObject({ label: 'Area unknown (ZIP not recognized)', points: 10 })
    expect(score(facts({ zip: null })).parts[0]).toMatchObject({ label: 'Area unknown (no ZIP)', points: 10 })
    expect(score(facts({ zip: '14001' }), 'x', 500).parts[0]).toMatchObject({ label: 'In area (always-serve ZIP)', points: 30 })
    expect(score(facts({ zip: '14221' }), 'x', 1).cap).toBe(15)
  })

  it('property tiers and the no-go cap', () => {
    expect(score(facts({ propertyType: 'Industrial warehouse' })).parts[1]).toMatchObject({ points: 15 })
    expect(score(facts({ propertyType: 'Stadium' })).parts[1]).toMatchObject({ label: 'Property type "Stadium" not recognized', points: 8 })
    expect(score(facts({ propertyType: null })).parts[1]).toMatchObject({ label: 'Property type unknown', points: 8 })
    const nogo = score(facts({ propertyType: 'Single family home' }))
    expect(nogo.cap).toBe(10)
    expect(nogo.rulesScore).toBe(10)
  })

  it('property keyword matching allows a plural suffix (I1 / R-E)', () => {
    expect(score(facts({ propertyType: 'Office Parks' })).parts[1]).toMatchObject({ label: 'Office park (great fit)', points: 25 })
  })

  it('a matching great/good property keyword wins over a co-occurring no-go keyword (C1 / R-D)', () => {
    const hoa1 = score(facts({ propertyType: 'Residential Homeowners Association' }))
    expect(hoa1.parts[1]).toMatchObject({ label: 'HOA / community association (great fit)', points: 25 })
    expect(hoa1.cap).toBeNull()

    const hoa2 = score(facts({ propertyType: 'Single Family HOA' }))
    expect(hoa2.parts[1]).toMatchObject({ label: 'HOA / community association (great fit)', points: 25 })
    expect(hoa2.cap).toBeNull()

    const singleFamily = score(facts({ propertyType: 'Single family home' }))
    expect(singleFamily.cap).toBe(10)
    expect(singleFamily.rulesScore).toBe(10)
  })

  it('size: big by sites or acres, small, unknown', () => {
    expect(score(facts({ sites: 2 })).parts[2]).toMatchObject({ label: '2 sites', points: 5 })
    expect(score(facts({ sites: null, acres: 3 })).parts[2]).toMatchObject({ label: '3 acres', points: 15 })
    expect(score(facts({ sites: null, acres: null })).parts[2]).toMatchObject({ label: 'Size unknown', points: 0 })
  })

  it('title: junior checked before decision-maker', () => {
    expect(score(facts(), 'Assistant Property Manager').parts[3]).toMatchObject({ label: 'Junior title', points: -10 })
    expect(score(facts(), 'Sales Rep').parts[3]).toMatchObject({ label: 'Other title', points: 5 })
    expect(score(facts(), null).parts[3]).toMatchObject({ label: 'No title', points: 5 })
  })

  it('title matching uses word boundaries, not substrings (I1 / R-E)', () => {
    expect(score(facts(), 'Director of International Operations').parts[3]).not.toMatchObject({ label: 'Junior title' })
    expect(score(facts(), 'Internal Facilities Manager').parts[3]).toMatchObject({ label: 'Decision-maker title', points: 15 })
    expect(score(facts(), 'Intern').parts[3]).toMatchObject({ label: 'Junior title', points: -10 })
    expect(score(facts(), 'Property Managers').parts[3]).toMatchObject({ label: 'Decision-maker title', points: 15 })
  })

  it('relationship: lost quote, prospect adds nothing', () => {
    expect(score(facts({ relationship: 'lost_quote' })).parts.at(-1)).toMatchObject({ label: 'Lost quote', points: 10 })
    expect(score(facts({ relationship: 'prospect' })).parts.some((p) => p.signal === 'relationship')).toBe(false)
  })

  it('clamps to 0..100 and reports distance', () => {
    const r = score(facts({ zip: null, propertyType: null, sites: null }), 'Intern')
    expect(r.rulesScore).toBe(SCORE_WEIGHTS.area.unknown + SCORE_WEIGHTS.property.unknown + SCORE_WEIGHTS.title.junior)
    expect(score(facts()).distanceMiles).toBe(10)
  })
})

describe('matchesKeyword', () => {
  it('matches case-insensitively with an optional plural suffix, bounded by non-letters/digits', () => {
    expect(matchesKeyword('Office Parks', 'office')).toBe(true)
    expect(matchesKeyword('Property Managers', 'property manager')).toBe(true)
    expect(matchesKeyword('Internal Facilities Manager', 'intern')).toBe(false)
    expect(matchesKeyword('Director of International Operations', 'intern')).toBe(false)
    expect(matchesKeyword('Intern', 'intern')).toBe(true)
    expect(matchesKeyword('Shoal Creek', 'hoa')).toBe(false)
    expect(matchesKeyword('HOA', 'hoa')).toBe(true)
  })

  it('escapes regex metacharacters in the keyword', () => {
    expect(matchesKeyword('c++ developer', 'c++')).toBe(true)
  })
})

describe('summarizeProfile', () => {
  it('includes the summary, services, tiers and titles', () => {
    const s = summarizeProfile(profile)
    expect(s).toContain('snow')
    expect(s).toContain('Great fit:')
    expect(s).toContain('Not a fit:')
    expect(s).toContain('property manager')
  })
})
