import { describe, it, expect } from 'vitest'
import { checkContent, levelOf } from './check-content'

const CLEAN_BODY =
  'Hi {firstName|there},\n\n{personalization}\n\nWe handle plowing, salting and sealcoating for commercial lots across Buffalo, and have kept properties like yours clear for over twenty years. Would a quick quote for next season be useful for {company}?\n\nThanks,\nJustin'
const base = { subject: 'Snow plan for {company}', body: CLEAN_BODY, isFirstStep: true, blockedPhrases: [] as string[] }
const rules = (o: Partial<typeof base> & { allowedWords?: string[] }) => checkContent({ ...base, ...o }).findings.map((f) => `${f.rule}:${f.severity}`)

describe('checkContent', () => {
  it('scores ordinary copy LOW with no findings', () => {
    expect(checkContent(base)).toEqual({ level: 'LOW', findings: [] })
  })

  it('flags a fake reply subject on the first step only', () => {
    expect(rules({ subject: 'Re: your parking lot' })).toContain('fake-reply:HIGH')
    expect(rules({ subject: 'FW: quote' })).toContain('fake-reply:HIGH')
    expect(rules({ subject: 'Re: your parking lot', isFirstStep: false })).not.toContain('fake-reply:HIGH')
  })

  it('flags link shorteners', () => {
    expect(rules({ body: `${CLEAN_BODY}\nhttps://bit.ly/abc` })).toContain('shortener:HIGH')
  })

  it('grades link counts: 1 ok, 2 MEDIUM, 3+ HIGH', () => {
    expect(rules({ body: `${CLEAN_BODY}\nhttps://acme.com` })).toEqual([])
    expect(rules({ body: `${CLEAN_BODY}\nhttps://acme.com www.acme.com/snow` })).toContain('two-links:MEDIUM')
    expect(rules({ body: `${CLEAN_BODY}\nhttps://a.com https://b.com https://c.com` })).toContain('too-many-links:HIGH')
  })

  it('flags guardrail terms and org phrases whole-word, honoring allowed words', () => {
    expect(rules({ body: `${CLEAN_BODY} Free estimate.` })).toContain('blocked-phrase:HIGH')
    expect(rules({ body: `${CLEAN_BODY} Only $500 per push.` })).toContain('blocked-phrase:HIGH')
    expect(rules({ body: `${CLEAN_BODY} We are carefree.` })).not.toContain('blocked-phrase:HIGH')
    expect(rules({ body: `${CLEAN_BODY} Free estimate.`, allowedWords: ['free'] })).not.toContain('blocked-phrase:HIGH')
    expect(rules({ body: `${CLEAN_BODY} Ask about our winter promo.`, blockedPhrases: ['winter promo'] })).toContain('blocked-phrase:HIGH')
  })

  it('flags HTML and images', () => {
    expect(rules({ body: `${CLEAN_BODY}<img src="x.png">` })).toContain('html:MEDIUM')
  })

  it('flags each trigger phrase once, case-insensitively', () => {
    const f = rules({ body: `${CLEAN_BODY} Act now, limited time! Click here.` })
    expect(f.filter((r) => r === 'trigger-phrase:MEDIUM')).toHaveLength(3)
  })

  it('flags shouting: 3+ all-caps words, !!, or emoji in the subject', () => {
    expect(rules({ body: `${CLEAN_BODY} BEST SNOW PLOWING TEAM` })).toContain('shouting:MEDIUM')
    expect(rules({ body: `${CLEAN_BODY} Call us HVAC LLC USA` })).not.toContain('shouting:MEDIUM') // 3-letter acronyms don't count
    expect(rules({ body: `${CLEAN_BODY} Thanks!!` })).toContain('shouting:MEDIUM')
    expect(rules({ subject: 'Snow plan ❄️' })).toContain('shouting:MEDIUM')
  })

  it('flags body length', () => {
    expect(rules({ body: 'Hi {firstName|there}, quick question about your lot?' })).toContain('short-body:LOW')
    expect(rules({ body: Array.from({ length: 205 }, () => 'word').join(' ') })).toContain('long-body:MEDIUM')
  })

  it('flags merge fields without a fallback, except always-filled ones, and unclosed braces', () => {
    expect(rules({ body: `${CLEAN_BODY} See you in {city}.` })).toContain('merge-field:MEDIUM')
    expect(rules({ body: `${CLEAN_BODY} See you in {city|your area}.` })).not.toContain('merge-field:MEDIUM')
    expect(rules({ body: `${CLEAN_BODY} Hi {firstName` })).toContain('merge-field:MEDIUM')
  })

  it('flags a long subject', () => {
    expect(rules({ subject: 'A very long subject line about commercial snow removal and salting' })).toContain('long-subject:LOW')
  })

  it('escalates three MEDIUM findings to HIGH', () => {
    expect(checkContent({ ...base, body: `${CLEAN_BODY} Act now. Limited time. Click here.` }).level).toBe('HIGH')
    expect(checkContent({ ...base, body: `${CLEAN_BODY} Act now.` }).level).toBe('MEDIUM')
  })

  it('levelOf returns the highest severity', () => {
    expect(levelOf([])).toBe('LOW')
    expect(levelOf([{ rule: 'x', severity: 'LOW', found: '', fix: '' }, { rule: 'y', severity: 'HIGH', found: '', fix: '' }])).toBe('HIGH')
  })
})
