import { describe, it, expect } from 'vitest'
import { checkGuardrails } from './guardrails'

const base = {
  subject: 'Snow plan for Acme',
  body: 'Hi Jane, we plow commercial lots in Buffalo.',
  personalization: null,
  templateText: 'Snow plan for {company}\nHi {firstName|there}, we plow commercial lots in Buffalo.',
  blockedPhrases: [],
  allowedWords: [],
}

describe('checkGuardrails', () => {
  it('passes clean content', () => {
    expect(checkGuardrails(base)).toEqual([])
  })
  it('flags an unfilled token', () => {
    expect(checkGuardrails({ ...base, body: 'Hi {firstName}, …' })).toContainEqual({
      rule: 'UNFILLED_TOKEN',
      match: '{firstName}',
    })
  })
  it('flags a dollar amount the template did not contain', () => {
    expect(checkGuardrails({ ...base, body: 'Plowing from $1,200 a season' })).toContainEqual({
      rule: 'CURRENCY',
      match: '$1,200',
    })
  })
  it('exempts a dollar amount written in the approved template', () => {
    const t = { ...base, templateText: base.templateText + ' Plans from $99.', body: 'Plans from $99.' }
    expect(checkGuardrails(t)).toEqual([])
  })
  it('flags risky words unless allowlisted', () => {
    const body = 'We guarantee a free estimate.'
    expect(checkGuardrails({ ...base, body }).map((f) => f.match.toLowerCase())).toEqual(['guarantee', 'free'])
    expect(checkGuardrails({ ...base, body, allowedWords: ['free'] }).map((f) => f.match)).toEqual(['guarantee'])
  })
  it('still flags risky words inside the AI line even if the template has them', () => {
    const t = {
      ...base,
      templateText: 'Get a free quote. {personalization}',
      body: 'Get a free quote. It is free forever.',
      personalization: 'It is free forever.',
    }
    expect(checkGuardrails(t)).toContainEqual({ rule: 'RISKY_WORD', match: 'free' })
  })
  it('flags org-blocked phrases case-insensitively', () => {
    expect(
      checkGuardrails({ ...base, body: 'We are the CHEAPEST in town', blockedPhrases: ['cheapest'] }),
    ).toContainEqual({ rule: 'BLOCKED_PHRASE', match: 'cheapest' })
  })
  it('flags an AI line over 60 words', () => {
    const long = Array.from({ length: 61 }, () => 'word').join(' ')
    expect(checkGuardrails({ ...base, personalization: long })).toContainEqual({
      rule: 'PERSONALIZATION_TOO_LONG',
      match: '61 words',
    })
  })
  it('does not duplicate identical flags', () => {
    expect(checkGuardrails({ ...base, body: 'free free free' })).toHaveLength(1)
  })
})
