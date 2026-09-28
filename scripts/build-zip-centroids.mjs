// Builds src/features/business-profile/server/zip-centroids.json from the US
// Census ZCTA gazetteer (public domain). Run: node scripts/build-zip-centroids.mjs
import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const URL = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_Gaz_zcta_national.zip'
const dir = mkdtempSync(join(tmpdir(), 'zcta-'))
const zipPath = join(dir, 'zcta.zip')
const res = await fetch(URL)
if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()))
execFileSync('unzip', ['-o', zipPath, '-d', dir])
const txt = readdirSync(dir).find((f) => f.endsWith('.txt'))
if (!txt) throw new Error('No .txt in archive')
const lines = readFileSync(join(dir, txt), 'utf8').trim().split('\n')
const header = lines[0].split('\t').map((h) => h.trim())
const iZip = header.indexOf('GEOID')
const iLat = header.indexOf('INTPTLAT')
const iLng = header.indexOf('INTPTLONG')
const out = {}
for (const line of lines.slice(1)) {
  const cols = line.split('\t').map((c) => c.trim())
  out[cols[iZip]] = [Number(Number(cols[iLat]).toFixed(4)), Number(Number(cols[iLng]).toFixed(4))]
}
writeFileSync('src/features/business-profile/server/zip-centroids.json', JSON.stringify(out))
console.log(`Wrote ${Object.keys(out).length} ZIPs`)
