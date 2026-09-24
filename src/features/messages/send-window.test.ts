import { describe, it, expect } from 'vitest'
import {
  isInSendWindow,
  isValidTimezone,
  mailboxSpacingMs,
  nextSendAt,
  zonedParts,
  type SendWindowConfig,
} from './send-window'

const CFG: SendWindowConfig = {
  timezone: 'America/New_York',
  businessHoursStart: 8,
  businessHoursEnd: 17,
  sendDays: [1, 2, 3, 4, 5],
}

describe('zonedParts', () => {
  it('converts UTC to the org timezone (EDT, UTC-4)', () => {
    // Wed 2026-09-23 13:05 UTC = 09:05 EDT
    expect(zonedParts(new Date('2026-09-23T13:05:00Z'), 'America/New_York')).toEqual({
      weekday: 3,
      hour: 9,
      minute: 5,
    })
  })
})

describe('isInSendWindow', () => {
  it('is open at 09:00 on a Wednesday (EDT)', () => {
    expect(isInSendWindow(new Date('2026-09-23T13:00:00Z'), CFG)).toBe(true)
  })
  it('is closed at 07:30 local', () => {
    expect(isInSendWindow(new Date('2026-09-23T11:30:00Z'), CFG)).toBe(false)
  })
  it('is closed at exactly 17:00 local (end is exclusive)', () => {
    expect(isInSendWindow(new Date('2026-09-23T21:00:00Z'), CFG)).toBe(false)
  })
  it('is open at 16:59 local', () => {
    expect(isInSendWindow(new Date('2026-09-23T20:59:00Z'), CFG)).toBe(true)
  })
  it('is closed on Saturday', () => {
    expect(isInSendWindow(new Date('2026-09-26T15:00:00Z'), CFG)).toBe(false)
  })
  it('handles EST (UTC-5) after the DST change: 08:30 EST Wed 2026-11-18 is 13:30 UTC', () => {
    expect(isInSendWindow(new Date('2026-11-18T13:30:00Z'), CFG)).toBe(true)
    // 12:30 UTC is 07:30 EST — closed (it would be 08:30 under EDT)
    expect(isInSendWindow(new Date('2026-11-18T12:30:00Z'), CFG)).toBe(false)
  })
})

describe('isValidTimezone', () => {
  it('accepts IANA names and rejects junk', () => {
    expect(isValidTimezone('America/Chicago')).toBe(true)
    expect(isValidTimezone('Not/AZone')).toBe(false)
  })
})

describe('mailboxSpacingMs', () => {
  it('spreads the daily limit across the window: 9h / 30 = 18 min', () => {
    expect(mailboxSpacingMs(CFG, 30)).toBe(18 * 60 * 1000)
  })
  it('never divides by zero', () => {
    expect(mailboxSpacingMs(CFG, 0)).toBe(9 * 60 * 60 * 1000)
  })
})

describe('nextSendAt', () => {
  const now = new Date('2026-09-23T13:00:00Z')
  it('applies -30% jitter at random=0', () => {
    expect(nextSendAt(now, 1_000_000, () => 0).getTime()).toBe(now.getTime() + 700_000)
  })
  it('applies +30% jitter at random→1', () => {
    expect(nextSendAt(now, 1_000_000, () => 1).getTime()).toBe(now.getTime() + 1_300_000)
  })
})
