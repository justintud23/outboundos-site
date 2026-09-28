// Server-only: the ZIP table is ~1 MB and must never reach a client bundle.
import centroids from './zip-centroids.json'
import type { Yard } from '../types'

const TABLE = centroids as unknown as Record<string, [number, number]>
const EARTH_RADIUS_MILES = 3958.8

export function zipLatLng(zip: string): [number, number] | null {
  return TABLE[zip] ?? null
}

export function zipExists(zip: string): boolean {
  return zip in TABLE
}

export function haversineMiles(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b[0] - a[0])
  const dLng = toRad(b[1] - a[1])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h))
}

/** The yard the ZIP is relatively closest to (smallest miles / radius). */
export function nearestYard(zip: string, yards: Yard[]): { miles: number; radiusMiles: number; yard: Yard } | null {
  const point = zipLatLng(zip)
  if (!point) return null
  let best: { miles: number; radiusMiles: number; yard: Yard } | null = null
  for (const yard of yards) {
    const yardPoint = zipLatLng(yard.zip)
    if (!yardPoint || yard.radiusMiles <= 0) continue
    const miles = haversineMiles(point, yardPoint)
    if (!best || miles / yard.radiusMiles < best.miles / best.radiusMiles) best = { miles, radiusMiles: yard.radiusMiles, yard }
  }
  return best
}
