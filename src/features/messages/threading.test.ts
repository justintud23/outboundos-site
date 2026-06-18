import { describe, it, expect } from 'vitest'
import {
  generateMessageId,
  stripRePrefix,
  buildReplySubject,
  buildThreadHeaders,
} from './threading'

describe('generateMessageId', () => {
  it('produces an angle-bracketed <local@domain> id', () => {
    const id = generateMessageId('example.com')
    expect(id).toMatch(/^<[^@<>]+@example\.com>$/)
  })

  it('is unique per call', () => {
    expect(generateMessageId('x')).not.toBe(generateMessageId('x'))
  })
})

describe('stripRePrefix', () => {
  it('removes a single Re:', () => {
    expect(stripRePrefix('Re: Hello')).toBe('Hello')
  })
  it('removes repeated / spaced / mixed-case Re:', () => {
    expect(stripRePrefix('RE: re:  Hello')).toBe('Hello')
    expect(stripRePrefix('re:Hello')).toBe('Hello')
  })
  it('leaves a non-Re subject untouched', () => {
    expect(stripRePrefix('Quarterly update')).toBe('Quarterly update')
  })
})

describe('buildReplySubject', () => {
  it('prefixes Re: once', () => {
    expect(buildReplySubject('Hello')).toBe('Re: Hello')
  })
  it('does NOT double-prefix an already-Re subject', () => {
    expect(buildReplySubject('Re: Hello')).toBe('Re: Hello')
    expect(buildReplySubject('RE: RE: Hello')).toBe('Re: Hello')
  })
})

describe('buildThreadHeaders', () => {
  it('returns no headers for an empty chain (first send)', () => {
    expect(buildThreadHeaders([])).toEqual({})
  })

  it('threads to the single prior message', () => {
    const h = buildThreadHeaders(['<a@h>'])
    expect(h.inReplyTo).toBe('<a@h>')
    expect(h.references).toEqual(['<a@h>'])
  })

  it('In-Reply-To is the most recent; References is the full chain oldest→newest', () => {
    const chain = ['<a@h>', '<b@h>', '<c@h>']
    const h = buildThreadHeaders(chain)
    expect(h.inReplyTo).toBe('<c@h>')
    expect(h.references).toEqual(['<a@h>', '<b@h>', '<c@h>'])
  })
})
