import { describe, it, expect } from 'vitest'
import { validateProfile } from './validate-profile'
import { PRESETS } from './presets'

const known = (zip: string) => zip === '14206' || zip === '14221'
const valid = () => ({ ...PRESETS.snow_paving, yards: [{ label: 'Buffalo', zip: '14206', radiusMiles: 35 }] })

describe('validateProfile', () => {
  it('accepts the snow & paving preset with one yard', () => {
    const res = validateProfile(valid(), known)
    expect(res.ok).toBe(true)
  })

  it.each([
    [{ yards: [] }, 'at least one yard'],
    [{ yards: Array.from({ length: 6 }, () => ({ label: 'Y', zip: '14206', radiusMiles: 10 })) }, 'at most 5 yards'],
    [{ yards: [{ label: 'Y', zip: '99999', radiusMiles: 10 }] }, 'ZIP 99999'],
    [{ yards: [{ label: 'Y', zip: '14206', radiusMiles: 0 }] }, 'radius'],
    [{ yards: [{ label: 'Y', zip: '14206', radiusMiles: 201 }] }, 'radius'],
    [{ companySummary: 'x'.repeat(601) }, '600'],
    [{ preset: 'plumbing' }, 'preset'],
    [{ propertyTypes: [{ label: 'X', keywords: ['x'], tier: 'meh' }] }, 'tier'],
    [{ alwaysZips: ['123'] }, '5-digit'],
    [{ bigSites: 0 }, 'sites'],
  ])('rejects %j', (patch, message) => {
    const res = validateProfile({ ...valid(), ...patch }, known)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain(message)
  })

  it('normalizes keywords, lists and column mapping', () => {
    const res = validateProfile({
      ...valid(),
      decisionTitleKeywords: ['  Property Manager ', 'property manager', ''],
      columnMapping: { propertyType: 'Account Type', bogus: 'x' },
    }, known)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.value.decisionTitleKeywords).toEqual(['property manager'])
      expect(res.value.columnMapping).toEqual({ propertyType: 'account_type' })
    }
  })

  it('defaults a missing yard label', () => {
    const res = validateProfile({ ...valid(), yards: [{ zip: '14206', radiusMiles: 10 }] }, known)
    expect(res.ok && res.value.yards[0]!.label).toBe('Yard 1')
  })
})
