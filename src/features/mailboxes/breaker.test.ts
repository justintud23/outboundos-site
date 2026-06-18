import { describe, it, expect } from 'vitest'
import {
  evaluateBreaker,
  BREAKER_MIN_VOLUME,
  BOUNCE_RATE_THRESHOLD,
  SPAM_RATE_THRESHOLD,
} from './breaker'

describe('evaluateBreaker', () => {
  it('does not trip below the bounce threshold', () => {
    // 4 bounces / 100 = 4% < 5%
    const v = evaluateBreaker({ sends: 100, bounces: 4, spamReports: 0 })
    expect(v.tripped).toBe(false)
    expect(v.reason).toBeNull()
  })

  it('trips at the bounce threshold', () => {
    // exactly 5%
    const v = evaluateBreaker({ sends: 100, bounces: 5, spamReports: 0 })
    expect(v.tripped).toBe(true)
    expect(v.reason).toMatch(/bounce rate/)
  })

  it('trips above the bounce threshold with a descriptive reason', () => {
    const v = evaluateBreaker({ sends: 100, bounces: 8, spamReports: 0 })
    expect(v.tripped).toBe(true)
    expect(v.reason).toBe('bounce rate 8.0% exceeded 5.0%')
  })

  it('trips on spam complaints at a much lower rate than bounces', () => {
    // 1 complaint / 1000 = 0.1% → trips (spam threshold), while the same rate of
    // bounces (0.1%) would not.
    const spam = evaluateBreaker({ sends: 1000, bounces: 0, spamReports: 1 })
    expect(spam.tripped).toBe(true)
    expect(spam.reason).toMatch(/spam-complaint rate/)

    const bounce = evaluateBreaker({ sends: 1000, bounces: 1, spamReports: 0 })
    expect(bounce.tripped).toBe(false)
  })

  it('reports spam before bounce when both breach', () => {
    const v = evaluateBreaker({ sends: 1000, bounces: 100, spamReports: 5 })
    expect(v.tripped).toBe(true)
    expect(v.reason).toMatch(/spam-complaint rate/)
  })

  it('NEVER trips below the minimum-volume floor, even at 100% bounce rate', () => {
    const sends = BREAKER_MIN_VOLUME - 1
    const v = evaluateBreaker({ sends, bounces: sends, spamReports: sends })
    expect(v.tripped).toBe(false)
    expect(v.reason).toBeNull()
  })

  it('zero sends never trips (avoids divide-by-zero)', () => {
    expect(evaluateBreaker({ sends: 0, bounces: 0, spamReports: 0 }).tripped).toBe(false)
  })

  it('exposes thresholds as the single source of truth', () => {
    expect(BOUNCE_RATE_THRESHOLD).toBe(0.05)
    expect(SPAM_RATE_THRESHOLD).toBe(0.001)
    expect(BREAKER_MIN_VOLUME).toBe(20)
  })
})
