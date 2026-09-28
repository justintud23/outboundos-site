import { describe, it, expect } from 'vitest'
import { zipExists, zipLatLng, haversineMiles, nearestYard } from './zip-distance'

describe('zip-distance', () => {
  it('knows real ZIPs and rejects unknown ones', () => {
    expect(zipExists('14206')).toBe(true)
    expect(zipExists('00000')).toBe(false)
    expect(zipLatLng('00000')).toBeNull()
  })

  it('computes a plausible straight-line distance (Buffalo 14206 → Williamsville 14221)', () => {
    const miles = haversineMiles(zipLatLng('14206')!, zipLatLng('14221')!)
    expect(miles).toBeGreaterThan(5)
    expect(miles).toBeLessThan(15)
  })

  it('picks the yard the lead is relatively closest to', () => {
    const yards = [
      { label: 'Buffalo', zip: '14206', radiusMiles: 10 },
      { label: 'Rochester', zip: '14604', radiusMiles: 30 },
    ]
    const near = nearestYard('14221', yards)!
    expect(near.yard.label).toBe('Buffalo')
    expect(near.radiusMiles).toBe(10)
  })

  it('returns null for an unknown lead ZIP or no usable yards', () => {
    expect(nearestYard('00000', [{ label: 'Y', zip: '14206', radiusMiles: 10 }])).toBeNull()
    expect(nearestYard('14206', [])).toBeNull()
  })
})
