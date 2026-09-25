# Industry Retargeting — Business Profile, Fit Scoring, Starter Sequences — Design

**Date:** 2026-09-25
**Status:** Draft — awaiting review
**Scope:** Roadmap sub-project 2 (see `2026-09-23-microsoft365-autosend-design.md`): retarget lead scoring, AI personalization and starter sequences from the original agency ICP to the organization's own trade. The first deployment is a commercial snow removal, salting and paving company.

## Context

OutboundOS was built for B2B agencies. It is now used by a commercial snow and paving contractor whose buyers are property managers, HOAs / community associations, retail and office landlords, and facilities teams. The app will also be sold to other companies.

### Today

- **Lead scoring** (`src/features/leads/server/score-leads.ts`):
  - One generic AI prompt ("B2B ICP fit": seniority, known company, email domain, completeness) over id/email/name/title/company only.
  - The CSV extra columns in `Lead.customFields` are ignored. So is location.
  - Scoring runs after import (`/api/leads/import`).
- **CSV import** stores extra columns in `customFields`, with headers normalized to `snake_case` lower-case (`transformHeader`).
- **Personalization:** the AI line is generated from firstName/lastName/company/title/customFields plus the step's `personalizationPrompt`. It knows nothing about the sender's business.
- **Sequences** are written from scratch. There are no templates.

### Decisions made during brainstorming

| Question | Decision |
|---|---|
| Lead data available | Property details (type, sites, lot size), location (city/state/ZIP), Salesforce exports of past customers / lost quotes (as CSV) |
| Where industry knowledge lives | Per-organization **Business profile** with presets; "Commercial snow & paving" pre-fills it. Not hard-coded. |
| Service area | One or more yards (ZIP + radius in miles) plus always/never ZIP lists; distance from a bundled US ZIP centroid table |
| Scoring approach | Deterministic rules score + AI adjustment within ±15 for leads not capped by a no-go rule |
| Starter sequences | Code-defined templates per preset, applied from the sequence form; 3 for snow & paving |

### Success criteria

1. With the snow & paving profile, an in-area HOA property manager with several sites scores above an out-of-area or residential lead, whatever their title.
2. Every score explains itself in plain words, and scoring the same data twice gives the same rules score.
3. An organization with no business profile keeps today's scoring unchanged.
4. A new user can create a first snow campaign from a starter template in minutes. The template's steps score Low on the content check.
5. No per-lead cost for distance: no geocoding API.

## Scope

### In scope

- `BusinessProfile` model, Settings UI and presets.
- A column recognizer (aliases + per-org mapping).
- The bundled ZIP centroid table and distance calculation.
- Rules scoring, AI adjustment, `scoreBreakdown`, and a "Rescore all" action.
- Profile context and derived fields in personalization.
- Derived merge fields `{propertyType}`, `{city}`, `{sites}`.
- Starter sequence templates and "Start from template" in the sequence form.

### Out of scope

- The public marketing site copy (only matters when selling).
- Salesforce API sync (sub-project 4); per-rep ownership (sub-project 3).
- Geocoding street addresses (ZIP only); drive-time instead of straight-line distance.
- A spring paving template set (can be added later in the same format).
- Changing how leads are imported or deduplicated.

## Design

### 1. Business profile

**Data.** A new model `BusinessProfile`, one per organization (`organizationId @unique`, cascade on org delete):

| Field | Type | Notes |
|---|---|---|
| `preset` | String | `'snow_paving' \| 'blank'` — which preset it was created from |
| `companySummary` | String | One paragraph of what the company does; AI context, max 600 chars |
| `services` | String[] | e.g. "snow plowing", "salting / de-icing", "sidewalk clearing", "asphalt paving", "sealcoating", "line striping", "patching / crack filling" |
| `yards` | Json | `{ label: string; zip: string; radiusMiles: number }[]`, 1–5 entries, radius 1–200 |
| `alwaysZips` | String[] | ZIPs always treated as in-area |
| `neverZips` | String[] | ZIPs always treated as out-of-area |
| `propertyTypes` | Json | `{ label: string; keywords: string[]; tier: 'great' \| 'good' \| 'no_go' }[]` |
| `decisionTitleKeywords` | String[] | e.g. "property manager", "facilities", "community association", "maintenance director", "owner", "asset manager" |
| `downrankTitleKeywords` | String[] | e.g. "assistant", "intern", "coordinator" |
| `bigSites` | Int | Number of sites at or above which a lead is "big" (default 5) |
| `bigAcres` | Float? | Lot size in acres at or above which a lead is "big" (default 2) |
| `columnMapping` | Json | `{ propertyType?: string; zip?: string; city?: string; state?: string; sites?: string; acres?: string; relationship?: string }` — CSV column key overrides |
| `createdAt` / `updatedAt` | | |

**Presets** (code, `src/features/business-profile/presets.ts`):

- **`snow_paving`** fills everything above:
  - Property types:
    - **great:** HOA / community association, retail center / shopping plaza, office park, medical / healthcare, apartment / multifamily
    - **good:** industrial / warehouse, school / church, hotel, restaurant
    - **no-go:** single-family residential
  - `bigSites` 5, `bigAcres` 2.
  - A sample `companySummary` the user edits.
- **`blank`** leaves everything empty (for other trades).

**Settings UI.**
- A "Business profile" section on the Settings page.
- With no profile yet, it shows a preset picker: "Commercial snow & paving" or "Start blank".
- After that, an editable form covers all the fields, including a yards editor (ZIP + radius + label, add/remove) and a property-type editor (label, keywords, tier).
- Saving validates:
  - yard ZIPs exist in the ZIP table
  - radius is 1–200
  - there are 1–5 yards
  - `companySummary` is at most 600 characters
- Unknown ZIPs are rejected with a clear message.
- Routes: `GET/PUT /api/settings/business-profile`, org-scoped, and `POST /api/settings/business-profile/rescore`.

### 2. Recognizing lead columns

`readLeadFacts(lead, profile)` in `src/features/business-profile/lead-facts.ts` is pure. It returns:

```ts
interface LeadFacts {
  zip: string | null          // first 5 digits
  city: string | null
  state: string | null
  propertyType: string | null // raw text
  sites: number | null
  acres: number | null
  relationship: 'past_customer' | 'lost_quote' | 'prospect' | null
}
```

- **Lookup order:** `profile.columnMapping[field]` first, then built-in aliases over the normalized `customFields` keys.
- **Aliases:**
  - zip: `zip`, `zip_code`, `zipcode`, `postal_code`, `postcode`, `property_zip`
  - city: `city`, `property_city`, `town`
  - state: `state`, `province`, `property_state`
  - propertyType: `property_type`, `type`, `segment`, `account_type`, `industry`
  - sites: `sites`, `number_of_sites`, `locations`, `properties`, `property_count`, `num_properties`
  - acres: `acres`, `lot_size`, `lot_acres`
  - relationship: `relationship`, `status`, `customer_status`, `lead_type`
- If no ZIP column exists, the ZIP is extracted from an `address` / `property_address` column (last 5-digit group).
- **Relationship text maps:**
  - "customer", "past customer", "former customer", "client" → `past_customer`
  - "lost", "quote", "quoted", "lost quote", "closed lost" → `lost_quote`
  - anything else non-empty → `prospect`
- Numbers are parsed leniently ("12 sites" → 12; "2.5 ac" → 2.5).

### 3. Distance

- `src/features/business-profile/zip-centroids.json`: the US Census ZCTA Gazetteer (public domain), reduced to `{ [zip]: [lat, lng] }` (~33k entries), with a generation script in `scripts/`.
- It is loaded lazily and only on the server.
- `nearestYardMiles(zip, yards)` uses the haversine formula and returns `{ miles, yard } | null`. Null means an unknown ZIP, or no yards.

### 4. Scoring

`scoreLeadByRules(facts, lead, profile)` is pure and returns `{ points, cap, parts: ScorePart[] }`, where `ScorePart = { signal, label, points }`.

| Signal | Rule | Points |
|---|---|---|
| **area** | ZIP in `alwaysZips`, or distance ≤ radius of the nearest yard | +30 "In area (N mi)" |
| | distance ≤ 1.25 × radius | +15 "Edge of area (N mi)" |
| | no ZIP / unknown ZIP | +10 "Area unknown" |
| | beyond 1.25 × radius, or ZIP in `neverZips` | cap 15 "Out of area (N mi)" |
| **property** | type matches a `great` keyword | +25 "<label> (great)" |
| | `good` | +15 |
| | no type / no match | +8 "Property type unknown" |
| | `no_go` | cap 10 "<label> (not a fit)" |
| **size** | sites ≥ bigSites or acres ≥ bigAcres | +15 "N sites" / "N acres" |
| | sites or acres present but below | +5 |
| **title** | contains a decision keyword | +15 "Decision-maker title" |
| | contains a downrank keyword (checked first) | −10 "Junior title" |
| | otherwise | +5 |
| **relationship** | past_customer | +15 "Past customer" |
| | lost_quote | +10 "Lost quote" |

- Keyword matching is case-insensitive substring on normalized text.
- `rulesScore = min(cap ?? 100, max(0, sum))`.

**AI adjustment.**
- Leads **without** a cap are sent to the AI in chunks of 25, as now. The input is the lead, its facts, `customFields`, and a profile summary (companySummary, services, property-type tiers, decision titles).
- The AI returns `{ leadId, adjustment: -15..15, reason }` via a new provider method `adjustLeadScores(leads, profileSummary)`.
- **Final score:** `clamp(rulesScore + clamp(adjustment, -15, 15), 0, 100)`.
- **Failures:**
  - A chunk that fails keeps the rules score, with the part "AI adjustment skipped".
  - A missing or invalid adjustment for a lead counts as 0 with "AI adjustment skipped".

**Storage.**
- `Lead.score` holds the final score. `Lead.scoredAt` is set to now.
- `Lead.scoreReason` holds the parts' labels joined with " · ", plus "AI ±N: <reason>".
- A new `Lead.scoreBreakdown Json?` holds `{ parts, rulesScore, cap, aiAdjustment, aiReason }`.

**Entry point.**
- `scoreLeads({ organizationId, leadIds })` keeps its signature and return type.
- If the org has a `BusinessProfile`, it uses the profile path. Otherwise it uses the existing generic path unchanged (success criterion 3).
- **Rescore all:** `POST /api/settings/business-profile/rescore` rescores the org's leads in batches of 200 (up to 60 s), oldest `scoredAt` first. It returns `{ rescored, remaining }`. The UI keeps calling while `remaining > 0`, showing progress.

**Lead UI.** The lead page shows the breakdown as a small table (signal, label, points), plus the AI line.

### 5. Personalization

- `PersonalizeInput` gains optional `profile?: { companySummary: string; services: string[] }` and `facts?: LeadFacts & { distanceMiles: number | null }`.
- The OpenAI personalize prompt adds these as context.
- The step's `personalizationPrompt` and all guardrails are unchanged: at most 60 words, no prices, blocked on AI failure.
- `runSequenceStep` (and the placement test) pass the profile and facts when the org has a profile.
- **Derived merge fields:** `renderTemplate` gains `propertyType`, `city` and `sites` from `readLeadFacts`. These are added to the lead passed to rendering; `customFields` wins if a CSV column has the same exact key.
  - Fallbacks work as today (`{city|your area}`).
  - The content check's `merge-field` rule treats them like other fields: a fallback is required.

### 6. Starter sequences

- **Definition:** `src/features/business-profile/starter-sequences.ts` exports `STARTER_SEQUENCES: Record<Preset, StarterSequence[]>`, where `StarterSequence = { id; name; description; steps: { stepNumber; subject; body; delayDays; personalizationPrompt }[] }`.
- **`snow_paving` includes:**
  1. **Snow — property managers & HOAs.** 4 steps, delays 0 / 3 / 7 / 14 days: intro + local credibility → reliability / response times → liability and documented salting logs → polite close-the-loop. The ask is a short call or a site walk for a quote.
  2. **Snow — retail & facilities.** 4 steps, same timing: keeping stores open, safe accessible parking, service logs for insurance.
  3. **Re-engage past customers & lost quotes.** 3 steps, delays 0 / 5 / 12: "we handled your lots before" / "we quoted you last season", with an offer to refresh the quote before the season fills up.
- **Copy rules (enforced by a test):**
  - every step scores **LOW** with `checkContent`
  - every merge field has a fallback, except `{firstName}`, `{company}` and `{personalization}`
  - step 1 bodies include `{personalization}`
  - no prices and no "free"
  - body 50–125 words
- **Sequence form:** a "Start from template" select (shown when the org's profile preset has templates) fills the name and steps. It is still a normal create; nothing is sent until the user enrolls leads and turns on auto-send.

### Data model changes (one migration)

| Model | Change |
|---|---|
| `BusinessProfile` | New, as above; `Organization` gains the relation |
| `Lead` | + `scoreBreakdown Json?` |

## Error handling

| Failure | Behavior |
|---|---|
| No business profile | Generic scoring and personalization, unchanged |
| Lead ZIP unknown / missing | "Area unknown" +10; flagged in the breakdown |
| Yard ZIP not in table | Profile save rejected with a message |
| AI adjustment chunk fails | Rules score kept, "AI adjustment skipped" |
| Rescore exceeds 60 s | Returns `remaining`; the UI continues in further calls |
| Malformed CSV numbers | Treated as missing (no points, no crash) |

## Testing

- **lead-facts:**
  - every alias
  - column mapping precedence
  - ZIP from address
  - relationship mapping
  - lenient number parsing
- **Distance:** a known pair of ZIPs within tolerance, nearest of multiple yards, unknown ZIP.
- **Rules scoring:** each row of the table, both caps, alwaysZips / neverZips, downrank before decision, total clamp.
- **scoreLeads:**
  - profile path vs no-profile path (unchanged)
  - capped leads skip the AI
  - adjustment clamp
  - chunk failure fallback
  - breakdown and reason stored
- **Rescore route:** org scoping, batching / `remaining`.
- **Profile routes:** validation (ZIPs, radius, yard count, summary length), preset creation.
- **Personalization:** the profile and facts reach the provider input; derived merge fields render; customFields precedence.
- **Starter sequences:** the copy-rules test over every template; the form fills steps from a template.
- **UI:** profile form (yards and property-type editors, save errors), breakdown table, rescore progress.

## Open risks

1. **ZIP centroids are approximate.** Large rural ZIPs can be miles off. The edge band and the always/never lists absorb most of this.
2. **Messy CSVs.** Unusual column names need the column mapping; the breakdown's "unknown" labels make gaps visible.
3. **Weights are a first guess.** They live in one constants object, so they're easy to tune after the first campaign's results.
4. **Bundle size.** The ZIP table (~1 MB JSON) is server-only and loaded lazily; it never ships to the browser.
