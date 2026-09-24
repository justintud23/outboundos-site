// Merge-field rendering for sequence templates.
// Syntax: {field} or {field|fallback}. Built-ins come from the Lead row; any
// other key is looked up in Lead.customFields (CSV extra columns). A field with
// no value and no fallback is left as-is so the guardrails BLOCK the draft
// instead of sending "Hi {firstName}".

export const PERSONALIZATION_TOKEN = '{personalization}'

export interface TemplateLead {
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  title?: string | null
  customFields?: unknown
}

const BUILTIN_FIELDS = new Set(['firstName', 'lastName', 'company', 'title'])
const TOKEN = /\{([a-zA-Z][a-zA-Z0-9_]*)(?:\|([^}]*))?\}/g

function toText(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim()
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  return ''
}

export function renderTemplate(text: string, lead: TemplateLead): string {
  const custom =
    lead.customFields && typeof lead.customFields === 'object' && !Array.isArray(lead.customFields)
      ? (lead.customFields as Record<string, unknown>)
      : {}

  return text.replace(TOKEN, (whole, key: string, fallback: string | undefined) => {
    if (key === 'personalization') return whole
    const raw = BUILTIN_FIELDS.has(key) ? lead[key as keyof TemplateLead] : custom[key]
    const value = toText(raw)
    if (value) return value
    if (fallback !== undefined) return fallback
    return whole
  })
}

export function insertPersonalization(body: string, line: string | null): string {
  return body
    .replace(PERSONALIZATION_TOKEN, line?.trim() ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
