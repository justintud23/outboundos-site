import { describe, it, expect } from 'vitest'
import { mapEventType } from './map-event-type'

describe('mapEventType', () => {
  it.each([
    ['delivered',   'DELIVERED'],
    ['open',        'OPENED'],
    ['click',       'CLICKED'],
    ['bounce',      'BOUNCED'],
    ['spamreport',  'SPAM_REPORT'],
    ['unsubscribe', 'UNSUBSCRIBED'],
    ['deferred',    'DEFERRED'],
    ['dropped',     'DROPPED'],
  ])('maps SendGrid "%s" to MessageEventType %s', (input, expected) => {
    expect(mapEventType(input)).toBe(expected)
  })

  it('returns null for unknown event types', () => {
    expect(mapEventType('processed')).toBeNull()
    expect(mapEventType('group_unsubscribe')).toBeNull()
    expect(mapEventType('')).toBeNull()
  })
})
