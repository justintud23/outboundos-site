// Canada's anti-spam law (CASL) requires consent even for B2B email, so cold
// outreach must not reach Canadian recipients. This decides — from whatever
// the lead record carries — whether a lead is (likely) Canadian, and why.
// Checked at every enrol/send, not just at import, so existing leads are covered.

export interface CanadaCheckLead {
  email: string
  phone?: string | null
  country?: string | null
  customFields?: unknown
}

const PROVINCES: Record<string, string> = {
  ab: 'Alberta', alberta: 'Alberta',
  bc: 'British Columbia', 'british columbia': 'British Columbia',
  mb: 'Manitoba', manitoba: 'Manitoba',
  nb: 'New Brunswick', 'new brunswick': 'New Brunswick',
  nl: 'Newfoundland and Labrador', 'newfoundland and labrador': 'Newfoundland and Labrador', newfoundland: 'Newfoundland and Labrador',
  ns: 'Nova Scotia', 'nova scotia': 'Nova Scotia',
  nt: 'Northwest Territories', 'northwest territories': 'Northwest Territories',
  nu: 'Nunavut', nunavut: 'Nunavut',
  on: 'Ontario', ontario: 'Ontario',
  pe: 'Prince Edward Island', 'prince edward island': 'Prince Edward Island', pei: 'Prince Edward Island',
  qc: 'Quebec', quebec: 'Quebec', québec: 'Quebec', pq: 'Quebec',
  sk: 'Saskatchewan', saskatchewan: 'Saskatchewan',
  yt: 'Yukon', yukon: 'Yukon',
}

// Geographic Canadian NANP area codes (CNAC list). Non-geographic codes (600,
// 622, 633, 644, 655, 677, 688) are excluded — they don't identify a place.
const CANADIAN_AREA_CODES = new Set([
  '204', '226', '236', '249', '250', '257', '263', '289', '306', '343', '354', '365', '367', '368', '382', '387',
  '403', '416', '418', '428', '431', '437', '438', '450', '460', '468', '474', '506', '514', '519', '548', '579',
  '581', '584', '587', '604', '613', '639', '647', '672', '683', '705', '709', '742', '753', '778', '780', '782',
  '807', '819', '825', '867', '873', '879', '902', '905', '942',
])

// CSV columns that carry a state/province (keys are lower_snake_case after import).
const REGION_KEYS = ['province', 'state', 'state_province', 'province_state', 'region']
const COUNTRY_KEYS = ['country', 'country_code']

export function normalizeCountry(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim()
  if (!v) return null
  const k = v.toLowerCase().replace(/\./g, '')
  if (k === 'ca' || k === 'can' || k === 'canada') return 'CA'
  if (k === 'us' || k === 'usa' || k === 'united states' || k === 'united states of america') return 'US'
  return v
}

function fields(customFields: unknown): Record<string, unknown> {
  return customFields && typeof customFields === 'object' && !Array.isArray(customFields)
    ? (customFields as Record<string, unknown>)
    : {}
}

function areaCode(phone: string): string | null {
  const trimmed = phone.trim()
  if (trimmed.startsWith('+') && !trimmed.startsWith('+1')) return null // non-NANP
  const digits = trimmed.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1, 4)
  if (digits.length === 10) return digits.slice(0, 3)
  return null
}

/** A human-readable reason the lead is treated as Canadian, or null. */
export function canadaExclusionReason(lead: CanadaCheckLead): string | null {
  const cf = fields(lead.customFields)

  const countries = [lead.country, ...COUNTRY_KEYS.map((k) => cf[k])]
  if (countries.some((c) => typeof c === 'string' && normalizeCountry(c) === 'CA')) return 'country is Canada'

  for (const key of REGION_KEYS) {
    const v = cf[key]
    if (typeof v !== 'string') continue
    const province = PROVINCES[v.trim().toLowerCase()]
    if (province) return `province is ${province}`
  }

  const domain = lead.email.split('@')[1]?.trim().toLowerCase() ?? ''
  if (domain.endsWith('.ca')) return 'email ends in .ca'

  if (lead.phone) {
    const code = areaCode(lead.phone)
    if (code && CANADIAN_AREA_CODES.has(code)) return `phone area code ${code} is Canadian`
  }

  return null
}
