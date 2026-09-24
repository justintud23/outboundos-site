// Content guardrails for auto-sent drafts. A non-empty result means the draft
// is BLOCKED and needs a human. Content rules (currency / risky words / blocked
// phrases) exempt text the human already approved in the step template — but
// never text inside the AI-written line.

export type GuardrailRule =
  | 'UNFILLED_TOKEN'
  | 'CURRENCY'
  | 'RISKY_WORD'
  | 'BLOCKED_PHRASE'
  | 'PERSONALIZATION_TOO_LONG'
  | 'AI_FAILED'

export interface GuardrailFlag {
  rule: GuardrailRule
  match: string
}

export interface GuardrailInput {
  subject: string
  body: string
  personalization: string | null
  templateText: string
  blockedPhrases: string[]
  allowedWords: string[]
}

export const MAX_PERSONALIZATION_WORDS = 60

const UNFILLED = /\{[^{}\s]+\}/g
const CURRENCY = /\$\s?\d[\d,]*(?:\.\d+)?/g
const RISKY = /\b(guarantee|guaranteed|free)\b/gi

export function checkGuardrails(input: GuardrailInput): GuardrailFlag[] {
  const text = `${input.subject}\n${input.body}`
  const template = input.templateText.toLowerCase()
  const aiLine = (input.personalization ?? '').toLowerCase()
  const allowed = new Set(input.allowedWords.map((w) => w.trim().toLowerCase()).filter(Boolean))

  const flags: GuardrailFlag[] = []
  const seen = new Set<string>()
  const add = (rule: GuardrailRule, match: string) => {
    const key = `${rule}:${match.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    flags.push({ rule, match })
  }
  // Exempt only when the human wrote it in the template AND the AI line doesn't contain it.
  const exempt = (m: string) => template.includes(m.toLowerCase()) && !aiLine.includes(m.toLowerCase())

  for (const m of text.match(UNFILLED) ?? []) add('UNFILLED_TOKEN', m)
  for (const m of text.match(CURRENCY) ?? []) if (!exempt(m)) add('CURRENCY', m)
  for (const m of text.match(RISKY) ?? []) {
    if (!allowed.has(m.toLowerCase()) && !exempt(m)) add('RISKY_WORD', m)
  }

  const lowerText = text.toLowerCase()
  for (const raw of input.blockedPhrases) {
    const phrase = raw.trim().toLowerCase()
    if (phrase && lowerText.includes(phrase) && !exempt(phrase)) add('BLOCKED_PHRASE', phrase)
  }

  if (input.personalization) {
    const words = input.personalization.trim().split(/\s+/).filter(Boolean).length
    if (words > MAX_PERSONALIZATION_WORDS) add('PERSONALIZATION_TOO_LONG', `${words} words`)
  }

  return flags
}
