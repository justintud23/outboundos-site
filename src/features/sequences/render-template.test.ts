import { describe, it, expect } from 'vitest'
import { renderTemplate, insertPersonalization } from './render-template'

describe('renderTemplate', () => {
  const lead = { firstName: 'Jane', lastName: 'Doe', company: 'Acme PM', title: null, customFields: { city: 'Buffalo', lots: 4 } }

  it('fills built-in and custom fields', () => {
    expect(renderTemplate('Hi {firstName} at {company} in {city} ({lots} lots)', lead)).toBe(
      'Hi Jane at Acme PM in Buffalo (4 lots)',
    )
  })
  it('uses the fallback when the value is missing or blank', () => {
    expect(renderTemplate('Hi {firstName|there}', { firstName: '  ' })).toBe('Hi there')
    expect(renderTemplate('Re: {title|your properties}', lead)).toBe('Re: your properties')
  })
  it('leaves a token with no value and no fallback untouched (guardrails catch it)', () => {
    expect(renderTemplate('Hi {firstName}', {})).toBe('Hi {firstName}')
  })
  it('never touches {personalization}', () => {
    expect(renderTemplate('{personalization}', lead)).toBe('{personalization}')
  })
  it('ignores non-object customFields', () => {
    expect(renderTemplate('{city|here}', { customFields: 'junk' })).toBe('here')
  })
})

describe('insertPersonalization', () => {
  it('replaces the marker with the line', () => {
    expect(insertPersonalization('Hi.\n\n{personalization}\n\nBye', 'Saw your lot.')).toBe(
      'Hi.\n\nSaw your lot.\n\nBye',
    )
  })
  it('removes the marker cleanly when there is no line', () => {
    expect(insertPersonalization('Hi.\n\n{personalization}\n\nBye', null)).toBe('Hi.\n\nBye')
  })
})
