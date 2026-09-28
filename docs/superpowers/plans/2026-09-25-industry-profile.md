# Industry Retargeting (Business Profile, Fit Scoring, Starter Sequences) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score and personalize leads from a per-organization business profile (with a "Commercial snow & paving" preset) and ship starter sequences, replacing the generic agency-oriented scoring for orgs that set up a profile.

**Architecture:**
- **Pure core:** a `business-profile` feature holds `presets`, profile validation, `readLeadFacts` (column aliases and mapping) and `scoreLeadByRules` (weights table).
- **Server side:** a bundled ZIP-centroid table gives distance. Profile CRUD and a rescore action sit behind org-scoped routes.
- **Scoring:** `scoreLeads` branches on whether the org has a profile. Rules score each lead; a new AI provider method adjusts uncapped leads by at most ±15.
- **Personalization:** gets the profile and lead facts through one helper. Derived merge fields `{propertyType}`, `{city}` and `{sites}` are added to the lead before rendering.
- **Starter sequences:** code constants that fill the sequence form.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict (`noUncheckedIndexedAccess`), Prisma 7 + Neon Postgres, Clerk Organizations, OpenAI (gpt-4o, JSON mode), Vitest + Testing Library, Tailwind v4 CSS variables.

**Spec:** `docs/superpowers/specs/2026-09-25-industry-profile-design.md`

## Global Constraints

- **Area points:**
  - in radius or `alwaysZips` → +30
  - ≤ 1.25 × radius → +15
  - no ZIP or unknown ZIP → +10
  - further out, or `neverZips` → cap 15
- **Property points:** great +25, good +15, unknown/unmatched +8, no-go → cap 10.
- **Size points:** big (sites ≥ `bigSites` or acres ≥ `bigAcres`) +15; sites or acres present but smaller +5.
- **Title points:** a down-rank keyword is checked first → −10; decision keyword → +15; otherwise +5.
- **Relationship points:** past_customer +15, lost_quote +10.
- **Score clamp:** `rulesScore = clamp(min(cap, sum), 0, 100)`.
- **AI adjustment:**
  - only for leads with no cap
  - clamped to −15..15; final score clamped to 0..100
  - chunks of 25
  - a failed chunk or missing result → adjustment 0 with the part "AI adjustment skipped"
- **Stored score:**
  - `scoreReason` = part labels joined with `" · "`
  - `scoreBreakdown` = `{ parts, rulesScore, cap, aiAdjustment, aiReason }`
- **No profile:** scoring and personalization behave exactly as today.
- **Profile validation:**
  - 1–5 yards, each a 5-digit ZIP present in the ZIP table, radius 1–200 miles
  - `companySummary` ≤ 600 characters
- **ZIP table:**
  - US Census ZCTA gazetteer centroids, `{ [zip]: [lat, lng] }`, 4-decimal precision
  - server-only
  - never imported by a client component
- **CSV keys** are already normalized by import to `snake_case` lower-case. Column-mapping values are normalized the same way (`trim().toLowerCase().replace(/\s+/g, '_')`).
- **Rescore:** batches of 200 leads per call with a 50 s budget. Returns `{ rescored, remaining, since }`, and the client re-calls with `since` until `remaining === 0`.
- **Starter templates:**
  - every step scores `LOW` with `checkContent`
  - every merge field has a fallback, except `{personalization}`
  - step-1 bodies contain `{personalization}`
  - body 50–125 words (counted as `checkContent` counts, merge fields excluded)
  - no links
- **Scoring weights** live in one exported constant `SCORE_WEIGHTS` (easy to tune).
- **Git and secrets:**
  - Commit on branch `feat/industry-profile`; never push; never print `.env`.
  - Every commit message ends with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Messy ZIPs from spreadsheets.** `Zip Code` headers, ZIP+4 (`14206-1234`), and ZIPs whose leading zero Excel stripped (`2108` for `02108`) must all resolve to the right 5-digit ZIP. 3–4 digit numeric values are left-padded. Test in Task 3.
2. **A no-go property type inside the service area.** The cap wins (score ≤ 10), and the lead is never sent to the AI. Test in Task 8.
3. **A lead ZIP that isn't in the table** (a PO-box-only ZIP or a typo) → "Area unknown (ZIP not recognized)" +10, never a crash. Test in Task 6.
4. **Rescoring a large list across several calls.** Leads already rescored in this run (`scoredAt ≥ since`) must not be rescored again on the next call, and `remaining` must reach 0. Test in Task 8.
5. **Orgs without a profile:**
  - the generic scoring prompt is still used on import
  - the sequence form shows no template picker
  - the personalization input has no `profile`/`facts` keys

  Tests in Tasks 8, 11 and 12.

---

## File structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20260927000000_business_profile/migration.sql` | `BusinessProfile` model, `Lead.scoreBreakdown` |
| `scripts/build-zip-centroids.mjs` | Download the Census gazetteer and write the JSON table |
| `src/features/business-profile/server/zip-centroids.json` | Generated ZIP → [lat, lng] table |
| `src/features/business-profile/server/zip-distance.ts` | `zipExists`, `haversineMiles`, `nearestYard` |
| `src/features/business-profile/types.ts` | Profile DTO and related types (client-safe) |
| `src/features/business-profile/presets.ts` | `PRESETS`, `PRESET_OPTIONS` (client-safe) |
| `src/features/business-profile/validate-profile.ts` | Pure validation / normalization |
| `src/features/business-profile/lead-facts.ts` | `readLeadFacts`, `templateLeadWithFacts` (pure) |
| `src/features/business-profile/score-rules.ts` | `SCORE_WEIGHTS`, `scoreLeadByRules`, `summarizeProfile` (pure) |
| `src/features/business-profile/server/profile.ts` | `getBusinessProfile`, `saveBusinessProfile` |
| `src/features/business-profile/server/lead-context.ts` | `getLeadContext` for personalization |
| `src/features/business-profile/server/rescore.ts` | `rescoreOrganizationLeads` |
| `src/features/business-profile/starter-sequences.ts` | `STARTER_SEQUENCES` (client-safe) |
| `src/features/business-profile/components/business-profile-section.tsx` | Settings UI |
| `src/features/business-profile/components/score-breakdown.tsx` | Lead page breakdown table |
| `src/app/api/settings/business-profile/route.ts`, `.../rescore/route.ts` | Routes |
| `src/lib/ai/provider.ts`, `src/lib/ai/openai.ts` | `adjustLeadScores`, personalize context |
| `src/features/leads/server/score-leads.ts` | Profile path |

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260927000000_business_profile/migration.sql`

**Interfaces:**
- Produces: Prisma model `BusinessProfile` (table `business_profiles`), `Organization.businessProfile`, `Lead.scoreBreakdown Json?`.

- [ ] **Step 1: Edit the schema**

Add this model, e.g. after `model DomainHealth { … }`:

```prisma
// Industry retargeting: what the org sells, where, and to whom. Drives fit
// scoring, AI personalization context and starter sequences. One per org.
model BusinessProfile {
  id                    String       @id @default(cuid())
  organizationId        String       @unique
  organization          Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  preset                String
  companySummary        String       @default("")
  services              String[]
  yards                 Json
  alwaysZips            String[]
  neverZips             String[]
  propertyTypes         Json
  decisionTitleKeywords String[]
  downrankTitleKeywords String[]
  bigSites              Int          @default(5)
  bigAcres              Float?
  columnMapping         Json
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  @@map("business_profiles")
}
```

In `model Organization`, beside `domainHealth DomainHealth[]`, add `businessProfile BusinessProfile?`.

In `model Lead`, after `scoredAt DateTime?`, add:

```prisma
  // Per-signal explanation of `score` when a BusinessProfile is used.
  scoreBreakdown Json?
```

- [ ] **Step 2: Write the migration**

```sql
-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "scoreBreakdown" JSONB;

-- CreateTable
CREATE TABLE "business_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "preset" TEXT NOT NULL,
    "companySummary" TEXT NOT NULL DEFAULT '',
    "services" TEXT[],
    "yards" JSONB NOT NULL,
    "alwaysZips" TEXT[],
    "neverZips" TEXT[],
    "propertyTypes" JSONB NOT NULL,
    "decisionTitleKeywords" TEXT[],
    "downrankTitleKeywords" TEXT[],
    "bigSites" INTEGER NOT NULL DEFAULT 5,
    "bigAcres" DOUBLE PRECISION,
    "columnMapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_organizationId_key" ON "business_profiles"("organizationId");

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Validate and generate**

Run: `npx prisma validate && npx prisma generate && npx tsc --noEmit && npx vitest run`
Expected: all pass (no behavior change).

Applying the migration to the dev DB is done by the controller, because implementer sandboxes may lack DB network. If you do have DB access, run `npx prisma migrate deploy`, then `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, and expect "empty migration". If the diff shows your SQL differs from what Prisma generates, use Prisma's version.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260927000000_business_profile
git commit -m "feat(business-profile): schema for business profile and score breakdown"
```

---

### Task 2: ZIP centroid table and distance

**Files:**
- Create: `scripts/build-zip-centroids.mjs`
- Create (generated): `src/features/business-profile/server/zip-centroids.json`
- Create: `src/features/business-profile/server/zip-distance.ts`
- Test: `src/features/business-profile/server/zip-distance.test.ts`

**Interfaces:**
- Consumes: `Yard` type (defined here in `../types.ts`; Task 4 extends that file; define the type now if the file doesn't exist).
- Produces:
  - `zipExists(zip: string): boolean`
  - `zipLatLng(zip: string): [number, number] | null`
  - `haversineMiles(a: [number, number], b: [number, number]): number`
  - `nearestYard(zip: string, yards: Yard[]): { miles: number; radiusMiles: number; yard: Yard } | null` — chooses the yard with the smallest `miles / radiusMiles`; `null` if the ZIP or every yard ZIP is unknown

- [ ] **Step 1: Write the generator script**

`scripts/build-zip-centroids.mjs`:

```js
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
```

Run: `node scripts/build-zip-centroids.mjs`
Expected: "Wrote 33xxx ZIPs".

If the sandbox has no internet, stop and report BLOCKED with that reason; the controller will run the script and commit the JSON.

- [ ] **Step 2: Write the failing test**

`src/features/business-profile/server/zip-distance.test.ts`:

```ts
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
```

Run: `npx vitest run src/features/business-profile/server/zip-distance.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

If `src/features/business-profile/types.ts` doesn't exist yet, create it with `export interface Yard { label: string; zip: string; radiusMiles: number }` (Task 4 adds the rest).

`src/features/business-profile/server/zip-distance.ts`:

```ts
// Server-only: the ZIP table is ~1 MB and must never reach a client bundle.
import centroids from './zip-centroids.json'
import type { Yard } from '../types'

const TABLE = centroids as Record<string, [number, number]>
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
```

If `tsc` rejects the JSON import, confirm `resolveJsonModule` is on in `tsconfig.json`; Next's default is on.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/features/business-profile/server/zip-distance.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-zip-centroids.mjs src/features/business-profile
git commit -m "feat(business-profile): bundled ZIP centroid table and distance helpers"
```

---

### Task 3: Lead facts from CSV columns

**Files:**
- Create: `src/features/business-profile/lead-facts.ts`
- Test: `src/features/business-profile/lead-facts.test.ts`
- Modify: `src/features/business-profile/types.ts` (add `ColumnMapping`, `LeadFacts`, `Relationship`)

**Interfaces:**
- Produces:
  - `type Relationship = 'past_customer' | 'lost_quote' | 'prospect'`
  - `interface ColumnMapping { propertyType?: string; zip?: string; city?: string; state?: string; sites?: string; acres?: string; relationship?: string }`
  - `interface LeadFacts { zip: string | null; city: string | null; state: string | null; propertyType: string | null; sites: number | null; acres: number | null; relationship: Relationship | null }`
  - `readLeadFacts(customFields: unknown, mapping?: ColumnMapping): LeadFacts`
  - `templateLeadWithFacts<T extends { customFields?: unknown }>(lead: T, facts: LeadFacts): T`: returns a copy whose `customFields` includes `propertyType`, `city` and `sites` (as strings), where the original `customFields` keys win on collision.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { readLeadFacts, templateLeadWithFacts } from './lead-facts'

describe('readLeadFacts', () => {
  it('reads aliased columns', () => {
    expect(readLeadFacts({ zip_code: '14206', city: 'Buffalo', state: 'NY', property_type: 'HOA', number_of_sites: '12', lot_size: '2.5 ac', customer_status: 'Past customer' })).toEqual({
      zip: '14206', city: 'Buffalo', state: 'NY', propertyType: 'HOA', sites: 12, acres: 2.5, relationship: 'past_customer',
    })
  })

  it('normalizes messy ZIPs (Review Focus #1)', () => {
    expect(readLeadFacts({ zip: '14206-1234' }).zip).toBe('14206')
    expect(readLeadFacts({ postal_code: 2108 }).zip).toBe('02108')
    expect(readLeadFacts({ zip: '501' }).zip).toBe('00501')
    expect(readLeadFacts({ zip: 'n/a' }).zip).toBeNull()
  })

  it('falls back to a ZIP inside an address column', () => {
    expect(readLeadFacts({ property_address: '123 Main St, Amherst, NY 14221-0001' }).zip).toBe('14221')
  })

  it('column mapping wins over aliases, and mapping values are normalized', () => {
    const facts = readLeadFacts({ type: 'Retail', account_type: 'Office Park' }, { propertyType: 'Account Type' })
    expect(facts.propertyType).toBe('Office Park')
  })

  it('maps relationship text', () => {
    expect(readLeadFacts({ status: 'Closed Lost' }).relationship).toBe('lost_quote')
    expect(readLeadFacts({ relationship: 'quoted 2024' }).relationship).toBe('lost_quote')
    expect(readLeadFacts({ relationship: 'Former client' }).relationship).toBe('past_customer')
    expect(readLeadFacts({ relationship: 'New' }).relationship).toBe('prospect')
    expect(readLeadFacts({}).relationship).toBeNull()
  })

  it('treats unparseable numbers as missing and tolerates non-object input', () => {
    expect(readLeadFacts({ sites: 'many' }).sites).toBeNull()
    expect(readLeadFacts(null)).toEqual({ zip: null, city: null, state: null, propertyType: null, sites: null, acres: null, relationship: null })
  })
})

describe('templateLeadWithFacts', () => {
  it('adds derived merge fields without overriding real columns', () => {
    const lead = { firstName: 'Jo', customFields: { city: 'Real City', property_type: 'HOA' } }
    const out = templateLeadWithFacts(lead, readLeadFacts(lead.customFields))
    expect(out.customFields).toMatchObject({ propertyType: 'HOA', city: 'Real City', property_type: 'HOA' })
    expect(lead.customFields).not.toHaveProperty('propertyType')
  })

  it('adds sites as a string', () => {
    const out = templateLeadWithFacts({ customFields: { sites: '8' } }, readLeadFacts({ sites: '8' }))
    expect((out.customFields as Record<string, unknown>).sites).toBe('8')
  })
})
```

Run: `npx vitest run src/features/business-profile/lead-facts.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

Append to `types.ts`:

```ts
export type Relationship = 'past_customer' | 'lost_quote' | 'prospect'

export interface ColumnMapping {
  propertyType?: string
  zip?: string
  city?: string
  state?: string
  sites?: string
  acres?: string
  relationship?: string
}

export interface LeadFacts {
  zip: string | null
  city: string | null
  state: string | null
  propertyType: string | null
  sites: number | null
  acres: number | null
  relationship: Relationship | null
}
```

`src/features/business-profile/lead-facts.ts`:

```ts
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
  // Excel strips leading zeros from New England ZIPs: 2108 → 02108.
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
```

Note: "Closed Lost" contains "lost" and "Past customer" contains "customer". Lost/quote is checked first, so "lost customer" counts as a lost quote.

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/features/business-profile/lead-facts.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/business-profile
git commit -m "feat(business-profile): read lead facts from CSV columns and derived merge fields"
```

---

### Task 4: Profile types, presets and validation

**Files:**
- Modify: `src/features/business-profile/types.ts`
- Create: `src/features/business-profile/presets.ts`
- Create: `src/features/business-profile/validate-profile.ts`
- Test: `src/features/business-profile/validate-profile.test.ts`

**Interfaces:**
- Produces:
  - `type PresetId = 'snow_paving' | 'blank'`
  - `type PropertyTier = 'great' | 'good' | 'no_go'`
  - `interface PropertyTypeRule { label: string; keywords: string[]; tier: PropertyTier }`
  - `interface BusinessProfileDTO { preset: PresetId; companySummary: string; services: string[]; yards: Yard[]; alwaysZips: string[]; neverZips: string[]; propertyTypes: PropertyTypeRule[]; decisionTitleKeywords: string[]; downrankTitleKeywords: string[]; bigSites: number; bigAcres: number | null; columnMapping: ColumnMapping }`
  - `PRESETS: Record<PresetId, BusinessProfileDTO>`
  - `PRESET_OPTIONS: { id: PresetId; label: string }[]`
  - `validateProfile(input: unknown, zipExists: (zip: string) => boolean): { ok: true; value: BusinessProfileDTO } | { ok: false; error: string }`

- [ ] **Step 1: Write the failing test**

```ts
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
```

Run: `npx vitest run src/features/business-profile/validate-profile.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement types and presets**

Append to `types.ts`:

```ts
export type PresetId = 'snow_paving' | 'blank'
export type PropertyTier = 'great' | 'good' | 'no_go'

export interface PropertyTypeRule {
  label: string
  keywords: string[]
  tier: PropertyTier
}

export interface BusinessProfileDTO {
  preset: PresetId
  companySummary: string
  services: string[]
  yards: Yard[]
  alwaysZips: string[]
  neverZips: string[]
  propertyTypes: PropertyTypeRule[]
  decisionTitleKeywords: string[]
  downrankTitleKeywords: string[]
  bigSites: number
  bigAcres: number | null
  columnMapping: ColumnMapping
}
```

`src/features/business-profile/presets.ts`:

```ts
import type { BusinessProfileDTO, PresetId } from './types'

// Presets pre-fill the Settings form; nothing is saved until the user adds a
// yard and clicks Save. Yards are left empty on purpose — only the user knows them.
export const PRESETS: Record<PresetId, BusinessProfileDTO> = {
  snow_paving: {
    preset: 'snow_paving',
    companySummary:
      'We are a commercial snow removal, salting and paving contractor. We keep parking lots, drives and walkways clear and safe all winter, with every visit logged, and we handle asphalt paving, sealcoating, striping and repairs in the warmer months.',
    services: ['snow plowing', 'salting / de-icing', 'sidewalk clearing', 'asphalt paving', 'sealcoating', 'line striping', 'patching / crack filling'],
    yards: [],
    alwaysZips: [],
    neverZips: [],
    propertyTypes: [
      { label: 'HOA / community association', keywords: ['hoa', 'homeowners association', 'community association', 'condo association', 'condominium', 'townhome'], tier: 'great' },
      { label: 'Retail center', keywords: ['retail', 'shopping', 'plaza', 'strip mall', 'mall', 'grocery'], tier: 'great' },
      { label: 'Office park', keywords: ['office', 'business park', 'corporate campus'], tier: 'great' },
      { label: 'Medical / healthcare', keywords: ['medical', 'hospital', 'clinic', 'healthcare', 'health care', 'dental', 'surgery center'], tier: 'great' },
      { label: 'Apartments / multifamily', keywords: ['apartment', 'multifamily', 'multi-family', 'residential community'], tier: 'great' },
      { label: 'Industrial / warehouse', keywords: ['industrial', 'warehouse', 'distribution', 'manufacturing', 'logistics'], tier: 'good' },
      { label: 'School / church', keywords: ['school', 'church', 'university', 'college', 'academy'], tier: 'good' },
      { label: 'Hotel', keywords: ['hotel', 'motel', 'hospitality', 'inn'], tier: 'good' },
      { label: 'Restaurant', keywords: ['restaurant', 'dining', 'cafe', 'bank branch'], tier: 'good' },
      { label: 'Single-family home', keywords: ['single-family', 'single family', 'homeowner', 'residential home'], tier: 'no_go' },
    ],
    decisionTitleKeywords: ['property manager', 'facilities', 'facility', 'community association manager', 'community manager', 'maintenance director', 'director of maintenance', 'owner', 'asset manager', 'operations manager', 'general manager', 'portfolio manager', 'board president'],
    downrankTitleKeywords: ['assistant', 'intern', 'coordinator', 'receptionist'],
    bigSites: 5,
    bigAcres: 2,
    columnMapping: {},
  },
  blank: {
    preset: 'blank',
    companySummary: '',
    services: [],
    yards: [],
    alwaysZips: [],
    neverZips: [],
    propertyTypes: [],
    decisionTitleKeywords: [],
    downrankTitleKeywords: [],
    bigSites: 5,
    bigAcres: null,
    columnMapping: {},
  },
}

export const PRESET_OPTIONS: { id: PresetId; label: string }[] = [
  { id: 'snow_paving', label: 'Commercial snow & paving' },
  { id: 'blank', label: 'Start blank (another trade)' },
]
```

- [ ] **Step 3: Implement validation**

`src/features/business-profile/validate-profile.ts`:

```ts
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
```

Services keep their case in the UI list but are stored lower-cased by `list`. That's acceptable; they only feed the AI.

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/features/business-profile && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/business-profile
git commit -m "feat(business-profile): profile types, snow & paving preset, validation"
```

---

### Task 5: Profile persistence and routes

**Files:**
- Create: `src/features/business-profile/server/profile.ts`
- Test: `src/features/business-profile/server/profile.test.ts`
- Create: `src/app/api/settings/business-profile/route.ts`
- Test: `src/app/api/settings/business-profile/route.test.ts`

**Interfaces:**
- Consumes: `validateProfile` and `BusinessProfileDTO` (Task 4); `zipExists` (Task 2).
- Produces:
  - `getBusinessProfile(organizationId: string): Promise<BusinessProfileDTO | null>`
  - `saveBusinessProfile(organizationId: string, input: unknown): Promise<BusinessProfileDTO>`, which throws `ProfileValidationError`
  - `class ProfileValidationError extends Error`
  - `GET /api/settings/business-profile` → `{ profile: BusinessProfileDTO | null }`
  - `PUT /api/settings/business-profile` → `{ profile }` | 400 `{ error }`

- [ ] **Step 1: Write the failing tests**

`profile.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { businessProfile: { findUnique: vi.fn(), upsert: vi.fn() } } }))
vi.mock('./zip-distance', () => ({ zipExists: (z: string) => z === '14206' }))

import { prisma } from '@/lib/db/prisma'
import { getBusinessProfile, saveBusinessProfile, ProfileValidationError } from './profile'
import { PRESETS } from '../presets'

type Fn = ReturnType<typeof vi.fn>
const bp = (prisma as unknown as { businessProfile: { findUnique: Fn; upsert: Fn } }).businessProfile
const input = { ...PRESETS.snow_paving, yards: [{ label: 'Buffalo', zip: '14206', radiusMiles: 35 }] }

beforeEach(() => vi.resetAllMocks())

describe('business profile persistence', () => {
  it('returns null when the org has no profile', async () => {
    bp.findUnique.mockResolvedValue(null)
    expect(await getBusinessProfile('org-1')).toBeNull()
    expect(bp.findUnique).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } })
  })

  it('maps a row to the DTO', async () => {
    bp.findUnique.mockResolvedValue({ id: 'bp', organizationId: 'org-1', ...input, createdAt: new Date(), updatedAt: new Date() })
    const dto = await getBusinessProfile('org-1')
    expect(dto).toMatchObject({ preset: 'snow_paving', yards: input.yards, bigSites: 5 })
    expect(dto).not.toHaveProperty('organizationId')
  })

  it('upserts a valid profile scoped to the org', async () => {
    bp.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'bp', ...create, createdAt: new Date(), updatedAt: new Date() }))
    await saveBusinessProfile('org-1', input)
    const args = bp.upsert.mock.calls[0]![0]
    expect(args.where).toEqual({ organizationId: 'org-1' })
    expect(args.create.organizationId).toBe('org-1')
    expect(args.update).not.toHaveProperty('organizationId')
  })

  it('throws ProfileValidationError for an unknown yard ZIP', async () => {
    await expect(saveBusinessProfile('org-1', { ...input, yards: [{ zip: '99999', radiusMiles: 10 }] })).rejects.toBeInstanceOf(ProfileValidationError)
    expect(bp.upsert).not.toHaveBeenCalled()
  })
})
```

`route.test.ts`, following the Clerk/resolveOrganization mocking style of `src/app/api/campaigns/[id]/content-override/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn(async () => ({ id: 'org-1' })) }))
vi.mock('@/features/business-profile/server/profile', async (orig) => ({
  ...(await orig<typeof import('@/features/business-profile/server/profile')>()),
  getBusinessProfile: vi.fn(),
  saveBusinessProfile: vi.fn(),
}))

import { auth } from '@clerk/nextjs/server'
import { getBusinessProfile, saveBusinessProfile, ProfileValidationError } from '@/features/business-profile/server/profile'
import { GET, PUT } from './route'

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1' } as never)
})

describe('/api/settings/business-profile', () => {
  it('403 without an org', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null, userId: null } as never)
    expect((await GET()).status).toBe(403)
  })

  it('GET returns the org profile (or null)', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue(null)
    const res = await GET()
    expect(await res.json()).toEqual({ profile: null })
    expect(getBusinessProfile).toHaveBeenCalledWith('org-1')
  })

  it('PUT saves and returns the profile', async () => {
    vi.mocked(saveBusinessProfile).mockResolvedValue({ preset: 'blank' } as never)
    const res = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ preset: 'blank' }) }))
    expect(res.status).toBe(200)
    expect(saveBusinessProfile).toHaveBeenCalledWith('org-1', { preset: 'blank' })
  })

  it('PUT maps validation errors to 400 and bad JSON to 400', async () => {
    vi.mocked(saveBusinessProfile).mockRejectedValue(new ProfileValidationError('Add at least one yard (ZIP and radius)'))
    const res = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({}) }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('yard')
    expect((await PUT(new Request('http://x', { method: 'PUT', body: 'nope' }))).status).toBe(400)
  })
})
```

Run: `npx vitest run src/features/business-profile/server/profile.test.ts "src/app/api/settings/business-profile"`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/features/business-profile/server/profile.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import type { BusinessProfileDTO, ColumnMapping, PresetId, PropertyTypeRule, Yard } from '../types'
import { validateProfile } from '../validate-profile'
import { zipExists } from './zip-distance'

export class ProfileValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProfileValidationError'
    Object.setPrototypeOf(this, ProfileValidationError.prototype)
  }
}

type Row = NonNullable<Awaited<ReturnType<typeof prisma.businessProfile.findUnique>>>

function toDTO(row: Row): BusinessProfileDTO {
  return {
    preset: row.preset as PresetId,
    companySummary: row.companySummary,
    services: row.services,
    yards: (row.yards as unknown as Yard[]) ?? [],
    alwaysZips: row.alwaysZips,
    neverZips: row.neverZips,
    propertyTypes: (row.propertyTypes as unknown as PropertyTypeRule[]) ?? [],
    decisionTitleKeywords: row.decisionTitleKeywords,
    downrankTitleKeywords: row.downrankTitleKeywords,
    bigSites: row.bigSites,
    bigAcres: row.bigAcres,
    columnMapping: (row.columnMapping as unknown as ColumnMapping) ?? {},
  }
}

export async function getBusinessProfile(organizationId: string): Promise<BusinessProfileDTO | null> {
  const row = await prisma.businessProfile.findUnique({ where: { organizationId } })
  return row ? toDTO(row) : null
}

export async function saveBusinessProfile(organizationId: string, input: unknown): Promise<BusinessProfileDTO> {
  const result = validateProfile(input, zipExists)
  if (!result.ok) throw new ProfileValidationError(result.error)
  const v = result.value
  const data = {
    preset: v.preset,
    companySummary: v.companySummary,
    services: v.services,
    yards: v.yards as unknown as object,
    alwaysZips: v.alwaysZips,
    neverZips: v.neverZips,
    propertyTypes: v.propertyTypes as unknown as object,
    decisionTitleKeywords: v.decisionTitleKeywords,
    downrankTitleKeywords: v.downrankTitleKeywords,
    bigSites: v.bigSites,
    bigAcres: v.bigAcres,
    columnMapping: v.columnMapping as unknown as object,
  }
  const row = await prisma.businessProfile.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  })
  return toDTO(row)
}
```

If Prisma's `Json` input typing rejects `object`, use `Prisma.InputJsonValue` casts.

`src/app/api/settings/business-profile/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getBusinessProfile, saveBusinessProfile, ProfileValidationError } from '@/features/business-profile/server/profile'

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const org = await resolveOrganization(orgId)
  return NextResponse.json({ profile: await getBusinessProfile(org.id) })
}

export async function PUT(request: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const body: unknown = await request.json().catch(() => undefined)
  if (body === undefined) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  try {
    const org = await resolveOrganization(orgId)
    return NextResponse.json({ profile: await saveBusinessProfile(org.id, body) })
  } catch (err) {
    if (err instanceof ProfileValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[PUT /api/settings/business-profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/features/business-profile "src/app/api/settings/business-profile" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/business-profile "src/app/api/settings/business-profile"
git commit -m "feat(business-profile): profile persistence and settings routes"
```

---

### Task 6: Rules scoring (pure)

**Files:**
- Create: `src/features/business-profile/score-rules.ts`
- Test: `src/features/business-profile/score-rules.test.ts`

**Interfaces:**
- Consumes: `LeadFacts`, `BusinessProfileDTO` (Tasks 3–4).
- Produces:
  - `SCORE_WEIGHTS`
  - `type ScoreSignal = 'area' | 'property' | 'size' | 'title' | 'relationship' | 'ai'`
  - `interface ScorePart { signal: ScoreSignal; label: string; points: number }`
  - `interface RulesScore { rulesScore: number; cap: number | null; parts: ScorePart[]; distanceMiles: number | null }`
  - `type NearestYardFn = (zip: string) => { miles: number; radiusMiles: number } | null`
  - `scoreLeadByRules(input: { facts: LeadFacts; title: string | null }, profile: BusinessProfileDTO, nearestYard: NearestYardFn): RulesScore`
  - `summarizeProfile(profile: BusinessProfileDTO): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { scoreLeadByRules, summarizeProfile, SCORE_WEIGHTS } from './score-rules'
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

describe('summarizeProfile', () => {
  it('includes the summary, services, tiers and titles', () => {
    const s = summarizeProfile(profile)
    expect(s).toContain('snow')
    expect(s).toContain('Great fit:')
    expect(s).toContain('Not a fit:')
    expect(s).toContain('property manager')
  })
})
```

Run: `npx vitest run src/features/business-profile/score-rules.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

`src/features/business-profile/score-rules.ts`:

```ts
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

const TIER_ORDER: PropertyTier[] = ['no_go', 'great', 'good']
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const fmt = (n: number) => String(Math.round(n * 10) / 10)

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

  // Property type
  const typeText = facts.propertyType?.toLowerCase() ?? null
  if (!typeText) {
    parts.push({ signal: 'property', label: 'Property type unknown', points: W.property.unknown })
  } else {
    let matched = false
    for (const tier of TIER_ORDER) {
      const rule = profile.propertyTypes.find((r) => r.tier === tier && r.keywords.some((k) => typeText.includes(k)))
      if (!rule) continue
      matched = true
      if (tier === 'no_go') {
        parts.push({ signal: 'property', label: `${rule.label} (not a fit)`, points: 0 })
        caps.push(W.property.noGoCap)
      } else {
        parts.push({ signal: 'property', label: `${rule.label} (${tier} fit)`, points: W.property[tier] })
      }
      break
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
  else if (profile.downrankTitleKeywords.some((k) => title.includes(k))) parts.push({ signal: 'title', label: 'Junior title', points: W.title.junior })
  else if (profile.decisionTitleKeywords.some((k) => title.includes(k))) parts.push({ signal: 'title', label: 'Decision-maker title', points: W.title.decision })
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
```

Check against the test: in "In area (10 mi)", `fmt(10)` gives "10". The perfect lead scores 30 + 25 + 15 + 15 + 15 = 100.

- [ ] **Step 3: Run the test**

Run: `npx vitest run src/features/business-profile/score-rules.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/business-profile
git commit -m "feat(business-profile): rules-based fit scoring with explained parts"
```

---

### Task 7: AI score adjustment provider method

**Files:**
- Modify: `src/lib/ai/provider.ts`
- Modify: `src/lib/ai/openai.ts`
- Test: `src/lib/ai/openai.test.ts` (add a `describe('OpenAIProvider.adjustLeadScores')`, following the file's existing mocking of `chat.completions.create`)

**Interfaces:**
- Produces:
  - in `provider.ts`: `interface LeadAdjustInput { id: string; title: string | null; company: string | null; facts: LeadFacts; details: unknown }` and `interface LeadAdjustOutput { leadId: string; adjustment: number; reason: string }`
  - the `AIProvider` method `adjustLeadScores(leads: LeadAdjustInput[], profileSummary: string): Promise<LeadAdjustOutput[]>`
  - The OpenAI implementation clamps `adjustment` to −15..15 (rounded), drops entries with a non-string `leadId`, and throws `DraftGenerationError` on request / parse failure (the caller isolates chunk failures).

- [ ] **Step 1: Write the failing test**

Mirror the existing `OpenAIProvider.personalize` tests' setup (read `openai.test.ts` first for how the client is mocked):

```ts
describe('OpenAIProvider.adjustLeadScores', () => {
  it('returns clamped adjustments per lead and fences the data', async () => {
    const create = mockCreateReturning({ adjustments: [{ leadId: 'l1', adjustment: 40, reason: 'Manages 14 HOAs' }, { leadId: 'l2', adjustment: -3.6, reason: 'Vendor' }, { leadId: 7, adjustment: 1, reason: 'x' }] })
    const provider = makeProvider()
    const out = await provider.adjustLeadScores(
      [{ id: 'l1', title: 'CAM', company: 'Acme HOA', facts: { zip: '14206', city: null, state: null, propertyType: 'HOA', sites: 14, acres: null, relationship: null }, details: {} }],
      'Company: snow',
    )
    expect(out).toEqual([{ leadId: 'l1', adjustment: 15, reason: 'Manages 14 HOAs' }, { leadId: 'l2', adjustment: -4, reason: 'Vendor' }])
    const messages = create.mock.calls[0]![0].messages
    expect(messages[0].content).toContain('Company: snow')
    expect(messages[0].content).toContain('-15')
    expect(messages[1].content).toContain('l1')
  })

  it('throws DraftGenerationError on a malformed response', async () => {
    mockCreateReturning('not json')
    await expect(makeProvider().adjustLeadScores([], 's')).rejects.toBeInstanceOf(DraftGenerationError)
  })
})
```

Adapt `mockCreateReturning` / `makeProvider` to the file's real helper names. If none exist, build them the way the personalize tests set up `chat.completions.create`.

Run: `npx vitest run src/lib/ai/openai.test.ts`
Expected: FAIL.

- [ ] **Step 2: Implement**

In `provider.ts`, add the two interfaces (import `LeadFacts` type from `@/features/business-profile/types`) and the interface method.

In `openai.ts`:

```ts
  async adjustLeadScores(leads: LeadAdjustInput[], profileSummary: string): Promise<LeadAdjustOutput[]> {
    const leadData = JSON.stringify(leads.map((l) => ({ id: l.id, title: l.title, company: l.company, facts: l.facts, details: l.details && typeof l.details === 'object' ? l.details : null })))
    const systemPrompt = `You help a contractor prioritize cold-outreach leads. Each lead already has a rules-based fit score;
you only fine-tune it using details the rules can't read (e.g. whether a title is really a decision-maker for
property services, or whether the company manages many properties).

About the sender:
${profileSummary}

For each lead return an adjustment between -15 and 15 (0 when nothing stands out) and a short reason (max 12 words).
Use only facts in the lead data. Never invent facts.

${UNTRUSTED_DATA_PREAMBLE}

Return a JSON object: { "adjustments": [ { "leadId": "<id>", "adjustment": <integer -15..15>, "reason": "<short>" } ] }`

    let content: string
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fenceUntrusted('leads', leadData) },
        ],
        temperature: 0.2,
        response_format: JSON_RESPONSE_FORMAT,
      })
      content = response.choices[0]?.message.content ?? ''
    } catch (err) {
      throw new DraftGenerationError('AI score adjustment failed.', err)
    }
    try {
      const raw = JSON.parse(content) as { adjustments?: unknown }
      if (!Array.isArray(raw.adjustments)) throw new SyntaxError('adjustments missing')
      return raw.adjustments.flatMap((a): LeadAdjustOutput[] => {
        const item = a as { leadId?: unknown; adjustment?: unknown; reason?: unknown }
        if (typeof item.leadId !== 'string') return []
        const n = typeof item.adjustment === 'number' && Number.isFinite(item.adjustment) ? Math.round(item.adjustment) : 0
        return [{ leadId: item.leadId, adjustment: Math.max(-15, Math.min(15, n)), reason: typeof item.reason === 'string' ? item.reason.slice(0, 120) : '' }]
      })
    } catch (err) {
      throw new DraftGenerationError('AI score adjustment returned an invalid response.', err)
    }
  }
```

Import `LeadAdjustInput` and `LeadAdjustOutput` into `openai.ts`.

`tsc` will flag any other object that claims to be an `AIProvider` (e.g. test fakes typed as `AIProvider`). Add `adjustLeadScores: vi.fn()` there.

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/lib/ai && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai
git commit -m "feat(ai): adjustLeadScores provider method (±15 fine-tuning)"
```

---

### Task 8: Profile-based `scoreLeads` and rescore

**Files:**
- Modify: `src/features/leads/server/score-leads.ts`
- Modify: `src/features/leads/server/score-leads.test.ts`
- Create: `src/features/business-profile/server/rescore.ts`
- Test: `src/features/business-profile/server/rescore.test.ts`
- Create: `src/app/api/settings/business-profile/rescore/route.ts`
- Test: `src/app/api/settings/business-profile/rescore/route.test.ts`

**Interfaces:**
- Consumes: `getBusinessProfile` (Task 5); `readLeadFacts` (Task 3); `scoreLeadByRules`, `summarizeProfile`, `SCORE_WEIGHTS`, `ScorePart` (Task 6); `nearestYard` (Task 2); `adjustLeadScores` (Task 7).
- Produces:
  - `scoreLeads` keeps its signature and return type. It writes `scoreBreakdown` when the org has a profile.
  - `interface ScoreBreakdown { parts: ScorePart[]; rulesScore: number; cap: number | null; aiAdjustment: number | null; aiReason: string | null }`, exported from `score-rules.ts`
  - `rescoreOrganizationLeads(organizationId: string, opts: { since?: Date; batchSize?: number; budgetMs?: number }): Promise<{ rescored: number; remaining: number; since: string }>`
  - `POST /api/settings/business-profile/rescore` `{ since?: string }` → `{ rescored, remaining, since }`

- [ ] **Step 1: Write the failing tests**

In `score-leads.test.ts`:
- Add `vi.mock('@/features/business-profile/server/profile', () => ({ getBusinessProfile: vi.fn() }))` and `vi.mock('@/features/business-profile/server/zip-distance', () => ({ nearestYard: vi.fn(() => ({ miles: 5, radiusMiles: 20 })) }))`.
- Add `adjustLeadScores: vi.fn()` to the mocked provider object. Make the provider a single shared object returned by `getAIProvider`, so tests can set it.
- Existing tests: `getBusinessProfile` resolves `null` (set in `beforeEach`). They must keep passing unchanged (Review Focus #5).

New tests:

```ts
describe('scoreLeads with a business profile', () => {
  const profile = { ...PRESETS.snow_paving, yards: [{ label: 'Y', zip: '14206', radiusMiles: 20 }] }
  const lead = (id: string, o: Record<string, unknown> = {}) => ({ id, email: `${id}@x.com`, firstName: null, lastName: null, company: 'Acme', title: 'Property Manager', customFields: { zip: '14210', property_type: 'HOA', sites: '8' }, ...o })

  beforeEach(() => {
    vi.mocked(getBusinessProfile).mockResolvedValue(profile)
  })

  it('stores rules + AI score, reason and breakdown; does not use the generic prompt', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([lead('l1')])
    provider.adjustLeadScores.mockResolvedValue([{ leadId: 'l1', adjustment: -5, reason: 'Vendor, not owner' }])
    const [r] = await scoreLeads({ organizationId: 'org-1', leadIds: ['l1'] })
    expect(r).toMatchObject({ leadId: 'l1', score: 80, success: true })
    const data = mockPrisma.lead.update.mock.calls[0]![0].data
    expect(data.scoreReason).toBe('In area (5 mi) · HOA / community association (great fit) · 8 sites · Decision-maker title · AI -5: Vendor, not owner')
    expect(data.scoreBreakdown).toMatchObject({ rulesScore: 85, cap: null, aiAdjustment: -5, aiReason: 'Vendor, not owner' })
    expect(provider.scoreLeads).not.toHaveBeenCalled()
    expect(mockPrisma.promptTemplate.findFirst).not.toHaveBeenCalled()
  })

  it('never sends capped leads to the AI (Review Focus #2)', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([lead('l1', { customFields: { zip: '14210', property_type: 'Single family home' } })])
    const [r] = await scoreLeads({ organizationId: 'org-1', leadIds: ['l1'] })
    expect(r!.score).toBe(10)
    expect(provider.adjustLeadScores).not.toHaveBeenCalled()
  })

  it('keeps the rules score when the AI chunk fails', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([lead('l1')])
    provider.adjustLeadScores.mockRejectedValue(new Error('boom'))
    const [r] = await scoreLeads({ organizationId: 'org-1', leadIds: ['l1'] })
    expect(r!.score).toBe(85)
    expect(mockPrisma.lead.update.mock.calls[0]![0].data.scoreReason).toContain('AI adjustment skipped')
  })

  it('clamps the final score to 0..100 and a missing adjustment counts as skipped', async () => {
    mockPrisma.lead.findMany.mockResolvedValue([lead('l1', { customFields: { zip: '14210', property_type: 'HOA', sites: '8', relationship: 'customer' } }), lead('l2')])
    provider.adjustLeadScores.mockResolvedValue([{ leadId: 'l1', adjustment: 15, reason: 'Big portfolio' }])
    const results = await scoreLeads({ organizationId: 'org-1', leadIds: ['l1', 'l2'] })
    expect(results.find((x) => x.leadId === 'l1')!.score).toBe(100)
    expect(mockPrisma.lead.update.mock.calls.find((c) => c[0].where.id === 'l2')![0].data.scoreReason).toContain('AI adjustment skipped')
  })
})
```

`rescore.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { lead: { findMany: vi.fn(), count: vi.fn() } } }))
vi.mock('@/features/leads/server/score-leads', () => ({ scoreLeads: vi.fn(async ({ leadIds }: { leadIds: string[] }) => leadIds.map((id) => ({ leadId: id, score: 50, reason: '', success: true }))) }))

import { prisma } from '@/lib/db/prisma'
import { scoreLeads } from '@/features/leads/server/score-leads'
import { rescoreOrganizationLeads } from './rescore'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { lead: { findMany: Fn; count: Fn } }
beforeEach(() => vi.resetAllMocks())

describe('rescoreOrganizationLeads (Review Focus #4)', () => {
  it('rescores leads not yet scored since `since`, oldest first, and reports remaining', async () => {
    const since = new Date('2026-10-01T00:00:00Z')
    p.lead.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]).mockResolvedValueOnce([])
    p.lead.count.mockResolvedValue(0)
    vi.mocked(scoreLeads).mockResolvedValue([])
    const res = await rescoreOrganizationLeads('org-1', { since, batchSize: 2 })
    expect(p.lead.findMany.mock.calls[0]![0]).toMatchObject({
      where: { organizationId: 'org-1', OR: [{ scoredAt: null }, { scoredAt: { lt: since } }] },
      orderBy: { scoredAt: { sort: 'asc', nulls: 'first' } },
      take: 2,
    })
    expect(scoreLeads).toHaveBeenCalledWith({ organizationId: 'org-1', leadIds: ['a', 'b'] })
    expect(res).toEqual({ rescored: 2, remaining: 0, since: since.toISOString() })
  })

  it('stops at the time budget and reports what is left', async () => {
    let t = 0
    vi.spyOn(Date, 'now').mockImplementation(() => (t += 30_000))
    p.lead.findMany.mockResolvedValue([{ id: 'a' }])
    p.lead.count.mockResolvedValue(7)
    vi.mocked(scoreLeads).mockResolvedValue([])
    const res = await rescoreOrganizationLeads('org-1', { batchSize: 1, budgetMs: 50_000 })
    expect(res.remaining).toBe(7)
    expect(res.rescored).toBeGreaterThanOrEqual(1)
    vi.restoreAllMocks()
  })
})
```

`rescore/route.test.ts` (same Clerk mocks as Task 5):
- 403 without an org.
- 400 on an invalid `since` (not a date).
- 200 passes `{ since: Date }` through and returns the JSON.
- It is org-scoped (called with `'org-1'`).

Run the three files. Expected: FAIL.

- [ ] **Step 2: Implement the profile path in `scoreLeads`**

In `score-leads.ts`:
1. Rename the current body after the empty-leads check to a local function `scoreWithPrompt(organizationId, leads)`, unchanged.
2. `scoreLeads` now:
   - fetches leads with `customFields: true` added to the select
   - returns `[]` if there are none
   - calls `const profile = await getBusinessProfile(organizationId)`
   - `if (!profile) return scoreWithPrompt(organizationId, leads)`
   - otherwise returns `scoreWithProfile(organizationId, leads, profile)`
3. Add:

```ts
async function scoreWithProfile(
  organizationId: string,
  leads: { id: string; title: string | null; company: string | null; customFields: unknown }[],
  profile: BusinessProfileDTO,
): Promise<LeadScoreResult[]> {
  const nearest: NearestYardFn = (zip) => nearestYard(zip, profile.yards)
  const scored = leads.map((lead) => {
    const facts = readLeadFacts(lead.customFields, profile.columnMapping)
    return { lead, facts, rules: scoreLeadByRules({ facts, title: lead.title }, profile, nearest) }
  })

  // Only uncapped leads get the AI's ±15 nudge (Review Focus #2).
  const eligible = scored.filter((s) => s.rules.cap === null)
  const summary = summarizeProfile(profile)
  const provider = getAIProvider()
  const adjustments = new Map<string, { adjustment: number; reason: string }>()
  await mapWithConcurrency(chunk(eligible, SCORING_CHUNK_SIZE), SCORING_CONCURRENCY, async (group) => {
    const ids = new Set(group.map((g) => g.lead.id))
    try {
      const out = await provider.adjustLeadScores(
        group.map((g) => ({ id: g.lead.id, title: g.lead.title, company: g.lead.company, facts: g.facts, details: g.lead.customFields })),
        summary,
      )
      for (const o of out) if (ids.has(o.leadId)) adjustments.set(o.leadId, o)
    } catch (err) {
      console.warn('[scoreLeads] AI adjustment chunk failed — keeping rules scores', err)
    }
  })

  const results: LeadScoreResult[] = []
  for (const { lead, rules } of scored) {
    const adj = rules.cap === null ? adjustments.get(lead.id) ?? null : null
    const aiAdjustment = adj ? Math.max(-SCORE_WEIGHTS.aiBand, Math.min(SCORE_WEIGHTS.aiBand, Math.round(adj.adjustment))) : null
    const parts: ScorePart[] = [...rules.parts]
    if (rules.cap === null) {
      parts.push(
        adj
          ? { signal: 'ai', label: `AI ${aiAdjustment! >= 0 ? '+' : ''}${aiAdjustment}: ${adj.reason}`, points: aiAdjustment! }
          : { signal: 'ai', label: 'AI adjustment skipped', points: 0 },
      )
    }
    const score = Math.max(0, Math.min(100, rules.rulesScore + (aiAdjustment ?? 0)))
    const reason = parts.map((p) => p.label).join(' · ')
    const breakdown: ScoreBreakdown = { parts, rulesScore: rules.rulesScore, cap: rules.cap, aiAdjustment, aiReason: adj?.reason ?? null }
    try {
      await prisma.lead.update({
        where: { id: lead.id, organizationId },
        data: { score, scoreReason: reason, scoredAt: new Date(), scoreBreakdown: breakdown as unknown as object },
      })
      results.push({ leadId: lead.id, score, reason, success: true })
    } catch (err) {
      console.error('Failed to persist score for lead', lead.id, err)
      results.push({ leadId: lead.id, score, reason, success: false })
    }
  }
  return results
}
```

Note the "+" sign formatting: `AI -5: …` for negatives and `AI +5: …` for positives. Add `export interface ScoreBreakdown { parts: ScorePart[]; rulesScore: number; cap: number | null; aiAdjustment: number | null; aiReason: string | null }` to `score-rules.ts`.

- [ ] **Step 3: Implement rescore and its route**

`src/features/business-profile/server/rescore.ts`:

```ts
import { prisma } from '@/lib/db/prisma'
import { scoreLeads } from '@/features/leads/server/score-leads'

/**
 * Rescores an org's leads in batches within a time budget. `since` marks the
 * start of this rescore run: leads scored at/after it are done and skipped, so
 * repeated calls (the UI loops while remaining > 0) never redo work.
 */
export async function rescoreOrganizationLeads(
  organizationId: string,
  opts: { since?: Date; batchSize?: number; budgetMs?: number } = {},
): Promise<{ rescored: number; remaining: number; since: string }> {
  const since = opts.since ?? new Date()
  const batchSize = opts.batchSize ?? 200
  const budgetMs = opts.budgetMs ?? 50_000
  const startedAt = Date.now()
  const pending = { organizationId, OR: [{ scoredAt: null }, { scoredAt: { lt: since } }] }
  let rescored = 0

  while (Date.now() - startedAt < budgetMs) {
    const batch = await prisma.lead.findMany({
      where: pending,
      orderBy: { scoredAt: { sort: 'asc', nulls: 'first' } },
      take: batchSize,
      select: { id: true },
    })
    if (batch.length === 0) break
    await scoreLeads({ organizationId, leadIds: batch.map((l) => l.id) })
    rescored += batch.length
  }

  const remaining = await prisma.lead.count({ where: pending })
  return { rescored, remaining, since: since.toISOString() }
}
```

If `scoreLeads` fails to persist a lead, its `scoredAt` stays old, so the loop could fetch the same lead again. Guard against that: track the ids processed in this call in a `Set`, and add `id: { notIn: [...processed] }` to the `findMany` where-clause.

`src/app/api/settings/business-profile/rescore/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { rescoreOrganizationLeads } from '@/features/business-profile/server/rescore'

export const maxDuration = 60

export async function POST(request: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { since?: unknown }
  let since: Date | undefined
  if (body.since !== undefined) {
    since = typeof body.since === 'string' ? new Date(body.since) : new Date(NaN)
    if (Number.isNaN(since.getTime())) return NextResponse.json({ error: 'Invalid since' }, { status: 400 })
  }
  try {
    const org = await resolveOrganization(orgId)
    return NextResponse.json(await rescoreOrganizationLeads(org.id, { since }))
  } catch (err) {
    console.error('[POST /api/settings/business-profile/rescore]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/leads/server/score-leads.test.ts src/features/business-profile "src/app/api/settings/business-profile" && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/leads/server src/features/business-profile "src/app/api/settings/business-profile"
git commit -m "feat(business-profile): profile-based scoring with AI adjustment, rescore action"
```

---

### Task 9: Business profile Settings UI

**Files:**
- Create: `src/features/business-profile/components/business-profile-section.tsx`
- Test: `src/features/business-profile/components/business-profile-section.test.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx` (load `getBusinessProfile(org.id)`)
- Modify: `src/app/(dashboard)/settings/settings-client.tsx` (render the section)

**Interfaces:**
- Consumes:
  - `PRESETS`, `PRESET_OPTIONS`, `BusinessProfileDTO` (Task 4)
  - `PUT /api/settings/business-profile`
  - `POST /api/settings/business-profile/rescore` (Tasks 5 and 8)
- Produces: `<BusinessProfileSection initialProfile={BusinessProfileDTO | null} />`

Behavior (pin every bullet with a test):

- **With no profile**, show "Set up your business profile" with a preset radio group, labelled by `PRESET_OPTIONS`, and a "Continue" button. Continuing loads `PRESETS[id]` into form state. Nothing is saved yet.
- **The form** (all controls labelled):
  - "Company summary" textarea (max 600, with a live character count)
  - "Services" textarea, one per line
  - **Yards** list: each row has "Yard name", "ZIP" and "Radius (miles)" inputs plus a "Remove yard" button; an "Add yard" button (max 5)
  - "Always-serve ZIPs" and "Never-serve ZIPs" textareas, one per line
  - **Property types** list: each row has a "Name" input, a "Keywords" input (comma-separated) and a "Fit" select (Great fit / Good fit / Not a fit), plus remove; an "Add property type" button
  - "Decision-maker titles" and "Junior titles" textareas, one per line
  - "Big customer: sites" and "Big customer: acres" number inputs (acres may be blank)
  - a collapsible "Column mapping" with seven text inputs ("Property type column", "ZIP column", "City column", "State column", "Sites column", "Acres column", "Relationship column"), placeholder "auto-detect"
- **"Save profile"**:
  - PUTs the whole DTO: lists are split on newlines/commas and trimmed, and numbers are numbers.
  - On 200, show "Profile saved. Rescore your leads to apply it." and a "Rescore all leads" button.
  - On error, show the server's `error` in `role="alert"`.
- **"Rescore all leads"**:
  - POSTs `{}`, then keeps POSTing `{ since }` while `remaining > 0`.
  - Shows "Rescored N leads…" progress, then "All leads rescored."
  - Disabled while running; errors in `role="alert"`.
  - try/catch/finally on every request, with the busy flag reset in `finally`.
- **Layout:** matches the existing Settings sections (card style of the sending settings form). Inputs use `w-full`; yard/property rows wrap (`flex-wrap`) at 375 px.

Tests:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BusinessProfileSection } from './business-profile-section'
import { PRESETS } from '../presets'

const fetchMock = vi.fn()
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', fetchMock) })
const saved = { ...PRESETS.snow_paving, yards: [{ label: 'Buffalo', zip: '14206', radiusMiles: 35 }] }

describe('BusinessProfileSection', () => {
  it('offers presets when there is no profile and pre-fills the form from the chosen preset', () => {
    render(<BusinessProfileSection initialProfile={null} />)
    fireEvent.click(screen.getByLabelText('Commercial snow & paving'))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((screen.getByLabelText('Company summary') as HTMLTextAreaElement).value).toContain('snow')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('adds a yard and saves the whole profile', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ profile: saved }), { status: 200 }))
    render(<BusinessProfileSection initialProfile={{ ...PRESETS.snow_paving }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add yard' }))
    fireEvent.change(screen.getByLabelText('ZIP'), { target: { value: '14206' } })
    fireEvent.change(screen.getByLabelText('Radius (miles)'), { target: { value: '35' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/settings/business-profile')
    const body = JSON.parse(init.body)
    expect(body.yards[0]).toMatchObject({ zip: '14206', radiusMiles: 35 })
    expect(body.propertyTypes.length).toBeGreaterThan(0)
    expect(await screen.findByText(/Profile saved/)).toBeInTheDocument()
  })

  it('shows a save error in an alert', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "Yard 1: ZIP 99999 isn't a known US ZIP code" }), { status: 400 }))
    render(<BusinessProfileSection initialProfile={saved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('99999')
  })

  it('rescores in batches until nothing remains', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ rescored: 200, remaining: 50, since: '2026-10-01T00:00:00.000Z' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ rescored: 50, remaining: 0, since: '2026-10-01T00:00:00.000Z' }), { status: 200 }))
    render(<BusinessProfileSection initialProfile={saved} />)
    fireEvent.click(screen.getByRole('button', { name: 'Rescore all leads' }))
    expect(await screen.findByText('All leads rescored.')).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ since: '2026-10-01T00:00:00.000Z' })
  })
})
```

With a saved profile, show "Rescore all leads" at all times, not only after a save.

- [ ] **Step 1:** Write the test file above. Run it. Expected: FAIL.
- [ ] **Step 2:** Implement the component as specified, then wire it in:
  - `settings/page.tsx` adds `getBusinessProfile(org.id)` to its `Promise.all` and passes `businessProfile` to `SettingsClient`.
  - `SettingsClient` gains a `businessProfile: BusinessProfileDTO | null` prop and renders `<BusinessProfileSection initialProfile={businessProfile} />` as its own section, after the sending settings.
  - Update existing SettingsClient/page tests for the new prop.
- [ ] **Step 3:** Run `npx vitest run src/features/business-profile "src/app/(dashboard)/settings" && npx tsc --noEmit && npx eslint src/features/business-profile "src/app/(dashboard)/settings"`. Expected: PASS.
- [ ] **Step 4: Commit**

```bash
git add src/features/business-profile "src/app/(dashboard)/settings"
git commit -m "feat(business-profile): Settings section with presets, yards, property types, rescore"
```

---

### Task 10: Score breakdown on the lead page

**Files:**
- Create: `src/features/business-profile/components/score-breakdown.tsx`
- Test: `src/features/business-profile/components/score-breakdown.test.tsx`
- Modify: `src/features/leads/types.ts` (`LeadDetailDTO` picks `'scoreBreakdown'`)
- Modify: `src/features/leads/server/get-lead.ts` (select `scoreBreakdown: true`)
- Modify: `src/app/(dashboard)/leads/[leadId]/page.tsx` (render the component)

**Interfaces:**
- Consumes: `ScoreBreakdown` (Task 8).
- Produces: `<ScoreBreakdownTable breakdown={unknown} />`. It renders nothing unless `breakdown` has a `parts` array.

Behavior:
- A small table (Signal, Detail, Points) with points shown signed (`+30`, `−10`, `0`).
- A footer row: "Score" and the rules score plus the AI adjustment. If `cap !== null`, add the note "Capped at {cap}: {the capping part's label}".
- It has an accessible caption "How this score was calculated".
- It goes in an `overflow-x-auto` wrapper.

Tests:
- renders every part with signed points
- shows the cap note
- renders nothing for `null`, `{}` or a legacy lead with no breakdown

Add the `scoreBreakdown: null` field to `LeadDetailDTO` fixtures that `tsc` flags.

- [ ] **Step 1:** Write the failing test. Run it. Expected: FAIL.
- [ ] **Step 2:** Implement; wire the DTO/select/page. On the page, place it right under the header card, inside the existing layout's column.
- [ ] **Step 3:** Run `npx vitest run src/features/business-profile src/features/leads && npx tsc --noEmit`. Expected: PASS.
- [ ] **Step 4: Commit**

```bash
git add src/features/business-profile src/features/leads "src/app/(dashboard)/leads"
git commit -m "feat(business-profile): explain each lead's score on the lead page"
```

---

### Task 11: Profile-aware personalization and derived merge fields

**Files:**
- Create: `src/features/business-profile/server/lead-context.ts`
- Test: `src/features/business-profile/server/lead-context.test.ts`
- Modify: `src/lib/ai/provider.ts` (`PersonalizeInput` gains `profile?`, `facts?`)
- Modify: `src/lib/ai/openai.ts` (`personalize` includes them)
- Modify: `src/features/sequences/server/run-sequence-step.ts`
- Modify: `src/features/placement-test/server/send-placement-test.ts`
- Tests: the existing test files of the three modified modules

**Interfaces:**
- Consumes: `getBusinessProfile` (Task 5); `readLeadFacts`, `templateLeadWithFacts` (Task 3); `nearestYard` (Task 2).
- Produces:
  - `getLeadContext(organizationId: string, customFields: unknown): Promise<{ profile: BusinessProfileDTO | null; facts: LeadFacts; distanceMiles: number | null }>`
  - `PersonalizeInput.profile?: { companySummary: string; services: string[] }`
  - `PersonalizeInput.facts?: LeadFacts & { distanceMiles: number | null }`

- [ ] **Step 1: Write the failing tests**

`lead-context.test.ts`:
- **With no profile:** the facts are read with the default aliases, and `profile` and `distanceMiles` are null.
- **With a profile:** its `columnMapping` is used, and `distanceMiles` is rounded from `nearestYard` (mock `./zip-distance` and `./profile`).

`openai.test.ts`, personalize:
- When `profile` and `facts` are given, the fenced user message JSON includes `sender: { companySummary, services }` and `facts`, and the system prompt mentions connecting the lead's property to the sender's services.
- When they're absent, the user message JSON has no `sender` or `facts` keys (Review Focus #5).

`run-sequence-step.test.ts`: add `vi.mock('@/features/business-profile/server/lead-context', () => ({ getLeadContext: vi.fn() }))`.
- Default: resolve `{ profile: null, facts: <all-null facts>, distanceMiles: null }`.
- New test: with a profile context, the `personalize` mock receives `profile` and `facts`, and a step body using `{city|your area}` renders the derived city from `facts.city` when the lead has a `property_city` column.
- New test: with `profile: null`, `personalize` receives exactly the old five keys (no `profile`/`facts`).

`send-placement-test.test.ts`: the same mock and default, plus one test that `personalize` receives `profile` when the context has one.

- [ ] **Step 2: Implement**

`lead-context.ts`:

```ts
import type { BusinessProfileDTO, LeadFacts } from '../types'
import { readLeadFacts } from '../lead-facts'
import { getBusinessProfile } from './profile'
import { nearestYard } from './zip-distance'

export async function getLeadContext(
  organizationId: string,
  customFields: unknown,
): Promise<{ profile: BusinessProfileDTO | null; facts: LeadFacts; distanceMiles: number | null }> {
  const profile = await getBusinessProfile(organizationId)
  const facts = readLeadFacts(customFields, profile?.columnMapping ?? {})
  const near = profile && facts.zip ? nearestYard(facts.zip, profile.yards) : null
  return { profile, facts, distanceMiles: near ? Math.round(near.miles) : null }
}
```

`openai.ts` `personalize`: build `leadData` from the existing object, adding `...(input.profile && { sender: input.profile })` and `...(input.facts && { facts: input.facts })`. Add this line to the system prompt, before the Rules paragraph:

"If sender details are present, connect the lead's property or situation to the sender's services; if facts are present, you may use the property type, town and size."

`run-sequence-step.ts`, in the step that renders the draft:

```ts
  const context = await getLeadContext(enrollment.organizationId, lead.customFields)
  const renderLead = templateLeadWithFacts(lead, context.facts)
```

- Pass `...(context.profile && { profile: { companySummary: context.profile.companySummary, services: context.profile.services }, facts: { ...context.facts, distanceMiles: context.distanceMiles } })` into the `personalize` input.
- Use `renderLead` (not `lead`) in both `renderTemplate` calls.
- Fetch the context once, before the personalization block.

Make the same change in `send-placement-test.ts`: context, `personalize` input, and the render lead (the sample lead goes through `templateLeadWithFacts` too).

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/features/business-profile src/lib/ai src/features/sequences src/features/placement-test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/business-profile src/lib/ai src/features/sequences src/features/placement-test
git commit -m "feat(business-profile): personalization uses the profile and lead facts; {propertyType} {city} {sites} merge fields"
```

---

### Task 12: Starter sequences

**Files:**
- Create: `src/features/business-profile/starter-sequences.ts`
- Test: `src/features/business-profile/starter-sequences.test.ts`
- Modify: `src/features/sequences/components/create-sequence-form.tsx`
- Modify: `src/features/sequences/components/create-sequence-form.test.tsx`
- Modify: `src/app/(dashboard)/sequences/page.tsx` and `sequences-client.tsx` (pass the templates)

**Interfaces:**
- Consumes: `PresetId` (Task 4); `checkContent` (existing).
- Produces:
  - `interface StarterStep { stepNumber: number; subject: string; body: string; delayDays: number; personalizationPrompt: string }`
  - `interface StarterSequence { id: string; name: string; description: string; steps: StarterStep[] }`
  - `STARTER_SEQUENCES: Record<PresetId, StarterSequence[]>` (`blank` → `[]`)
  - `CreateSequenceForm` gains an optional `starterSequences?: StarterSequence[]` prop

- [ ] **Step 1: Write the copy-rules test (failing)**

```ts
import { describe, it, expect } from 'vitest'
import { STARTER_SEQUENCES } from './starter-sequences'
import { checkContent } from '@/features/content-check/check-content'

const all = STARTER_SEQUENCES.snow_paving
const words = (body: string) => body.replace(/\{[^}]*\}/g, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length

describe('snow & paving starter sequences', () => {
  it('has the three sequences with the specified timing', () => {
    expect(all.map((s) => s.name)).toEqual(['Snow — property managers & HOAs', 'Snow — retail & facilities', 'Re-engage past customers & lost quotes'])
    expect(all[0]!.steps.map((s) => s.delayDays)).toEqual([0, 3, 7, 14])
    expect(all[1]!.steps.map((s) => s.delayDays)).toEqual([0, 3, 7, 14])
    expect(all[2]!.steps.map((s) => s.delayDays)).toEqual([0, 5, 12])
    expect(STARTER_SEQUENCES.blank).toEqual([])
  })

  it.each(all.flatMap((s) => s.steps.map((step) => [`${s.name} step ${step.stepNumber}`, step] as const)))('%s passes the copy rules', (_name, step) => {
    const result = checkContent({ subject: step.subject, body: step.body, isFirstStep: step.stepNumber === 1, blockedPhrases: [] })
    expect(result.findings.filter((f) => f.severity !== 'LOW')).toEqual([])
    expect(result.level).toBe('LOW')
    for (const m of `${step.subject}\n${step.body}`.matchAll(/\{([a-zA-Z_]+)(\|[^}]*)?\}/g)) {
      if (m[1] !== 'personalization') expect(m[2], `${m[0]} needs a fallback`).toBeTruthy()
    }
    if (step.stepNumber === 1) {
      expect(step.body).toContain('{personalization}')
      expect(step.personalizationPrompt.length).toBeGreaterThan(20)
    }
    expect(words(step.body)).toBeGreaterThanOrEqual(50)
    expect(words(step.body)).toBeLessThanOrEqual(125)
    expect(step.body).not.toMatch(/https?:\/\/|www\./)
  })
})
```

Run it. Expected: FAIL.

- [ ] **Step 2: Write the templates**

`src/features/business-profile/starter-sequences.ts`. Use this copy verbatim. Step bodies are template literals; keep the blank lines.

```ts
import type { PresetId } from './types'

export interface StarterStep { stepNumber: number; subject: string; body: string; delayDays: number; personalizationPrompt: string }
export interface StarterSequence { id: string; name: string; description: string; steps: StarterStep[] }

const PM_PROMPT = 'Mention their property type and town if known, and one specific winter risk for that kind of property (icy walkways for residents, parking for tenants). Do not invent facts.'
const RETAIL_PROMPT = 'Mention their store or facility type and town if known, and why reliable early-morning clearing matters for it. Do not invent facts.'
const REENGAGE_PROMPT = 'Reference that they are a past customer or received a quote from us, using only what the lead data says. Keep it warm and brief. Do not invent dates or details.'

export const STARTER_SEQUENCES: Record<PresetId, StarterSequence[]> = {
  snow_paving: [
    {
      id: 'snow-pm-hoa',
      name: 'Snow — property managers & HOAs',
      description: 'Cold outreach to property managers and community associations for winter service quotes.',
      steps: [
        { stepNumber: 1, delayDays: 0, personalizationPrompt: PM_PROMPT, subject: 'Winter coverage for {company|your properties}', body: `Hi {firstName|there},

{personalization}

We handle commercial snow plowing, salting and sidewalk clearing for property managers and associations around {city|your area}. Most of our clients came to us after a season of late plows or missed salt runs, and they stay because every visit is logged with times and photos.

Would a short call or a quick site walk next week make sense, so we can put together a quote for this winter?

Thanks,` },
        { stepNumber: 2, delayDays: 3, personalizationPrompt: '', subject: 'Plow response times', body: `Hi {firstName|there},

A quick follow-up on winter service for {company|your properties}. The question we hear most from property managers is how fast the trucks show up once snow starts. Our routes are built so every lot is cleared before business hours, and we re-plow and re-salt during long storms instead of waiting for the next morning.

If it helps, I can send over a sample service log from last season so you can see exactly what gets recorded.

Thanks,` },
        { stepNumber: 3, delayDays: 7, personalizationPrompt: '', subject: 'Slip-and-fall paperwork', body: `Hi {firstName|there},

One more thought for {company|your properties}. When a slip-and-fall claim comes in, the first thing an insurer asks for is proof of when the lot and walks were plowed and salted. We record every visit with time stamps, temperatures and material used, and you can pull those records any time.

Happy to walk your {propertyType|property} with you and put together a written quote before the season fills up.

Thanks,` },
        { stepNumber: 4, delayDays: 14, personalizationPrompt: '', subject: 'Should I close your file?', body: `Hi {firstName|there},

I haven't heard back, so I'll assume winter service is already covered for {company|your properties} this year. If that changes, or if you'd like a second quote to compare before signing, just reply to this email and we'll set up a time to look at the site.

Either way, thanks for reading, and I hope the season goes smoothly.

Thanks,` },
      ],
    },
    {
      id: 'snow-retail-facilities',
      name: 'Snow — retail & facilities',
      description: 'Cold outreach to retail centers and facilities managers for winter service quotes.',
      steps: [
        { stepNumber: 1, delayDays: 0, personalizationPrompt: RETAIL_PROMPT, subject: 'Winter service for {company|your locations}', body: `Hi {firstName|there},

{personalization}

We plow, salt and clear sidewalks for retail centers and commercial facilities around {city|your area}. For stores, the goal is simple: open on time with safe, accessible parking and entrances, no matter when the snow falls overnight.

Every visit is logged with times, conditions and material used, which your insurance team will appreciate. Could we set up a short call or a site walk to quote this winter?

Thanks,` },
        { stepNumber: 2, delayDays: 3, personalizationPrompt: '', subject: 'Keeping lots open overnight', body: `Hi {firstName|there},

Following up on winter service for {company|your locations}. Most retail and facilities teams tell us their biggest headache is a lot that isn't cleared when the first employees arrive. Our crews work overnight routes timed around your opening hours, and we come back to re-salt when temperatures drop again during the day.

Would it help if I sent over a sample route plan and service log?

Thanks,` },
        { stepNumber: 3, delayDays: 7, personalizationPrompt: '', subject: 'Documented service for insurance', body: `Hi {firstName|there},

One more note for {company|your locations}. Retail sites see a lot of foot traffic in winter, and slip-and-fall claims usually come down to records. We log every plow and salt visit with time stamps and conditions, and you can request those records whenever you need them.

If you'd like, we can walk your {propertyType|site} and put together a written quote before the season fills up.

Thanks,` },
        { stepNumber: 4, delayDays: 14, personalizationPrompt: '', subject: 'Closing the loop', body: `Hi {firstName|there},

I haven't heard back, so I'll assume snow service for {company|your locations} is already set for this winter. If anything changes, or you'd like a second quote to compare, just reply here and we'll find a time to look at your sites.

Thanks for reading, and I hope the season is an easy one.

Thanks,` },
      ],
    },
    {
      id: 'reengage-customers-quotes',
      name: 'Re-engage past customers & lost quotes',
      description: 'Warm outreach to past customers and last season’s quotes before winter routes fill up.',
      steps: [
        { stepNumber: 1, delayDays: 0, personalizationPrompt: REENGAGE_PROMPT, subject: 'Winter service for {company|your properties} this year', body: `Hi {firstName|there},

{personalization}

We've worked with {company|your team} before, either on past winter service or on a quote, and I wanted to check in before the season fills up. Our routes around {city|your area} are being planned now, and returning clients get first choice of start times.

Would you like me to refresh your quote for this winter, or set up a quick site walk if anything has changed?

Thanks,` },
        { stepNumber: 2, delayDays: 5, personalizationPrompt: '', subject: 'Refreshing your winter quote', body: `Hi {firstName|there},

Following up on this winter's snow service for {company|your properties}. A lot has changed since last season on our side: more trucks on your side of town, a dedicated salting crew, and service logs you can look up whenever you need them.

If you send over anything that has changed at your sites, I'll put an updated quote together this week.

Thanks,` },
        { stepNumber: 3, delayDays: 12, personalizationPrompt: '', subject: 'Last check-in before winter', body: `Hi {firstName|there},

This is my last note before our winter routes are set. If you'd like us back on your lots at {company|your properties} this season, just reply and I'll get a quote over quickly. If you've gone with someone else, no problem at all, and thanks for the time. Either way, we're happy to help with paving, sealcoating or striping in the spring as well.

Thanks,` },
      ],
    },
  ],
  blank: [],
}
```

If the copy-rules test fails on a step (e.g. a word count or a content-check finding), adjust that step's wording minimally so it passes. Keep the meaning, and note the change in your report. Do not weaken the test.

- [ ] **Step 3: Wire up "Start from template"**

In `create-sequence-form.tsx`:
- Add the prop `starterSequences?: StarterSequence[]` (default `[]`).
- When it's non-empty, render a labelled "Start from template" `Select` above the steps. Its first option is "Blank sequence"; the other options are the template names.
- Selecting a template sets `name` to its name and `steps` to `template.steps.map(({ subject, body, delayDays, personalizationPrompt }) => ({ subject, body, delayDays, personalizationPrompt }))`.
- Selecting "Blank sequence" resets to one empty step.

Add tests to `create-sequence-form.test.tsx`:
- With templates, choosing one fills the name and step count (4), and the first step's body contains `{personalization}`.
- With no `starterSequences` prop, there's no "Start from template" control (Review Focus #5).

In the sequences page/client, load `getBusinessProfile(org.id)` and pass `starterSequences={profile ? STARTER_SEQUENCES[profile.preset] : []}` through to the form.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/features/business-profile src/features/sequences "src/app/(dashboard)/sequences" && npx tsc --noEmit && npx eslint src/features/business-profile src/features/sequences "src/app/(dashboard)/sequences"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/business-profile src/features/sequences "src/app/(dashboard)/sequences"
git commit -m "feat(business-profile): snow & paving starter sequences and Start from template"
```

---

### Task 13: Docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1:** Add a `## Business profile & lead scoring` section before `## Deliverability`. It covers:
  - **Set up:** Settings → Business profile → "Commercial snow & paving" preset → add your yard ZIP and radius → Save → Rescore all leads.
  - **How scores work:** the points table from Global Constraints, the no-go and out-of-area caps, the AI ±15, and where to see the breakdown (lead page).
  - **CSV tips:**
    - include a ZIP (or address), property type, number of sites or acres, and a relationship column ("past customer", "lost quote") for Salesforce exports
    - recognized column names (the alias lists from Task 3)
    - use Column mapping for anything else
  - **Merge fields** `{propertyType}`, `{city}` and `{sites}`, always with a fallback.
  - **Starter sequences:** Sequences → New → Start from template. Edit the wording, and add your name under "Thanks," before enrolling leads.
  - **Orgs without a profile** keep the original generic scoring.
- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: business profile, fit scoring and starter sequences"
```

---

## Self-review notes (for the executor)

**Spec coverage**

| Spec section | Task(s) |
|---|---|
| 1. Business profile (model, presets, Settings, routes) | 1, 4, 5, 9 |
| 2. Recognizing lead columns | 3 |
| 3. Distance / ZIP table | 2 |
| 4. Scoring (rules, AI adjust, storage, entry point, rescore, lead UI) | 6, 7, 8, 10 |
| 5. Personalization + derived merge fields | 3, 11 |
| 6. Starter sequences | 12 |
| Error handling table | 2 (unknown ZIP), 4–5 (validation), 8 (AI failure, rescore batching), 3 (malformed numbers) |
| Docs | 13 |

**Interfaces that cross tasks, and must match**

- `Yard`, `LeadFacts`, `ColumnMapping`, `BusinessProfileDTO` (`types.ts`)
- `nearestYard(zip, yards)` → `{ miles, radiusMiles, yard } | null`
- `readLeadFacts(customFields, mapping?)`
- `templateLeadWithFacts(lead, facts)`
- `scoreLeadByRules({ facts, title }, profile, nearestYardFn)` → `{ rulesScore, cap, parts, distanceMiles }`
- `ScorePart`, `ScoreBreakdown`
- `getBusinessProfile(orgId)`
- `adjustLeadScores(leads, profileSummary)`
- `getLeadContext(orgId, customFields)`
- `STARTER_SEQUENCES[preset]`
