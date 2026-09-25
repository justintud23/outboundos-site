// Template spam-risk heuristics for plain-text cold email. Pure — runs in the
// browser (live badges) and on the server (the auto-send gate). These catch
// common mistakes; they are not a model of any filter.

export type Severity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface Finding {
  rule: string
  severity: Severity
  found: string
  fix: string
}

export interface ContentResult {
  level: Severity
  findings: Finding[]
}

export interface ContentInput {
  subject: string
  body: string
  isFirstStep: boolean
  blockedPhrases: string[]
  allowedWords?: string[]
}

export const TRIGGER_PHRASES = [
  'act now', 'limited time', 'risk-free', 'risk free', 'click here', '100%', 'no obligation', 'buy now',
  'order now', 'special promotion', 'exclusive deal', 'cash', 'winner', 'urgent', 'once in a lifetime',
  'double your', 'earn money', 'lowest price', 'best price',
] as const

const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'rebrand.ly', 'cutt.ly']
const LINK = /(?:https?:\/\/|www\.)[^\s<>"')]+/gi
const HTML = /<img\b|<a\s|<table\b|<div\b|<span\b|<font\b|style\s*=/i
const FAKE_REPLY = /^\s*(re|fwd|fw)\s*:/i
const TOKEN = /\{([a-zA-Z][a-zA-Z0-9_]*)(\|[^{}]*)?\}/g
const ALWAYS_FILLED = new Set(['firstName', 'company', 'personalization'])
const CAPS_WORD = /\b[A-Z]{4,}\b/g
const EMOJI = /\p{Extended_Pictographic}/u
const GUARDRAIL_WORDS = ['free', 'guarantee', 'guaranteed']
const CURRENCY = /\$\s?\d[\d,]*(?:\.\d+)?/

const RANK: Record<Severity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 }

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Case-insensitive match not glued to other letters/digits ("free" ≠ "carefree"). */
function containsPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(phrase)}(?![\\p{L}\\p{N}])`, 'iu').test(text)
}

function wordCount(text: string): number {
  return text.replace(TOKEN, ' ').split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

export function levelOf(findings: Finding[]): Severity {
  if (findings.length === 0) return 'LOW'
  if (findings.filter((f) => f.severity === 'MEDIUM').length >= 3) return 'HIGH'
  return findings.reduce<Severity>((max, f) => (RANK[f.severity] > RANK[max] ? f.severity : max), 'LOW')
}

export function checkContent(input: ContentInput): ContentResult {
  const { subject, body } = input
  const both = `${subject}\n${body}`
  const findings: Finding[] = []
  const add = (rule: string, severity: Severity, found: string, fix: string) => findings.push({ rule, severity, found, fix })

  if (input.isFirstStep && FAKE_REPLY.test(subject)) {
    add('fake-reply', 'HIGH', subject.trim(), 'Remove "Re:"/"Fwd:" — a first email pretending to be a reply is misleading and filtered.')
  }

  const links = body.match(LINK) ?? []
  const shortened = links.find((l) => {
    const stripped = l.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '')
    const host = stripped.match(/^[^/?#]+/)?.[0] ?? stripped
    return SHORTENERS.includes(host)
  })
  if (shortened) add('shortener', 'HIGH', shortened, 'Use the full link to your own site; shortened links are a strong spam signal.')
  if (links.length >= 3) add('too-many-links', 'HIGH', `${links.length} links`, 'Keep cold emails to one link at most (the unsubscribe footer is added for you).')
  else if (links.length === 2) add('two-links', 'MEDIUM', '2 links', 'Cut to one link, or none — ask for a reply instead.')

  const allowed = new Set((input.allowedWords ?? []).map((w) => w.trim().toLowerCase()).filter(Boolean))
  for (const word of GUARDRAIL_WORDS) {
    if (!allowed.has(word) && containsPhrase(both, word)) add('blocked-phrase', 'HIGH', word, `Remove "${word}" — it is blocked in drafts and a classic spam word.`)
  }
  const money = both.match(CURRENCY)
  if (money) add('blocked-phrase', 'HIGH', money[0], 'Leave prices out of the first emails; talk numbers once they reply.')
  for (const raw of input.blockedPhrases) {
    const phrase = raw.trim()
    if (phrase && containsPhrase(both, phrase)) add('blocked-phrase', 'HIGH', phrase, `"${phrase}" is on your blocked-phrase list (Settings).`)
  }

  if (HTML.test(body)) add('html', 'MEDIUM', 'HTML or image tags', 'Write plain text — images and HTML formatting hurt cold-email placement.')

  for (const phrase of TRIGGER_PHRASES) {
    if (containsPhrase(both, phrase)) add('trigger-phrase', 'MEDIUM', phrase, `Reword "${phrase}" — it reads like an ad.`)
  }

  const caps = both.replace(TOKEN, ' ').match(CAPS_WORD) ?? []
  const shout = caps.length >= 3 ? caps.slice(0, 3).join(' ') : both.includes('!!') ? '!!' : EMOJI.test(subject) ? 'emoji in subject' : null
  if (shout) add('shouting', 'MEDIUM', shout, 'Drop the all-caps words, repeated "!" and emoji — write like a normal email.')

  const words = wordCount(body)
  if (words > 200) add('long-body', 'MEDIUM', `${words} words`, 'Aim for 50–125 words; cold emails over 200 words get skimmed and filtered.')
  else if (words < 25) add('short-body', 'LOW', `${words} words`, 'Add a sentence of context — very short emails can look like spam probes.')

  const withoutTokens = both.replace(TOKEN, '')
  if (/[{}]/.test(withoutTokens)) add('merge-field', 'MEDIUM', 'unclosed { or }', 'Close every merge field, e.g. {city|your area}.')
  for (const m of both.matchAll(TOKEN)) {
    const [whole, field, fallback] = m
    if (!fallback && field && !ALWAYS_FILLED.has(field)) {
      add('merge-field', 'MEDIUM', whole, `Add a fallback, e.g. {${field}|…}, or the draft is blocked when ${field} is empty.`)
    }
  }

  if (subject.trim().length > 60) add('long-subject', 'LOW', `${subject.trim().length} characters`, 'Keep subjects under 60 characters so they aren\'t cut off.')

  return { level: levelOf(findings), findings }
}
