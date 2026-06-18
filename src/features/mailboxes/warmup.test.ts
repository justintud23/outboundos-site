import { describe, it, expect } from 'vitest'
import {
  effectiveDailyLimit,
  warmupDay,
  isWarmingUp,
  WARMUP_RAMP_PER_DAY,
  WARMUP_DAYS,
} from './warmup'

// A fixed reference "now" and helper to build a warmup-start N days earlier.
const NOW = new Date('2026-06-17T12:00:00Z')
function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)
}

function mb(overrides: Partial<{ dailyLimit: number; warmupEnabled: boolean; warmupStartedAt: Date }>) {
  return {
    dailyLimit: 500,
    warmupEnabled: true,
    warmupStartedAt: NOW,
    ...overrides,
  }
}

describe('warmupDay', () => {
  it('is day 1 on the start day', () => {
    expect(warmupDay(NOW, NOW)).toBe(1)
  })

  it('counts calendar days from the start (day N after N-1 days)', () => {
    expect(warmupDay(daysAgo(2), NOW)).toBe(3)
    expect(warmupDay(daysAgo(11), NOW)).toBe(12)
  })

  it('never returns less than 1', () => {
    expect(warmupDay(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(1)
  })
})

describe('effectiveDailyLimit', () => {
  it('day 1 returns the ramp floor', () => {
    expect(effectiveDailyLimit(mb({ warmupStartedAt: NOW }), NOW)).toBe(WARMUP_RAMP_PER_DAY[0])
  })

  it('mid-ramp returns the scheduled value for that day', () => {
    // day 3 → index 2
    expect(effectiveDailyLimit(mb({ warmupStartedAt: daysAgo(2) }), NOW)).toBe(WARMUP_RAMP_PER_DAY[2])
  })

  it('past the full ramp returns the configured dailyLimit', () => {
    const past = daysAgo(WARMUP_DAYS + 5)
    expect(effectiveDailyLimit(mb({ dailyLimit: 500, warmupStartedAt: past }), NOW)).toBe(500)
  })

  it('warmupEnabled=false returns dailyLimit regardless of day', () => {
    expect(effectiveDailyLimit(mb({ dailyLimit: 50, warmupEnabled: false, warmupStartedAt: NOW }), NOW)).toBe(50)
  })

  it('never exceeds dailyLimit (ramp capped by the configured limit)', () => {
    // dailyLimit 25 with a day-12 ramp cap of 500 → min() yields 25.
    expect(effectiveDailyLimit(mb({ dailyLimit: 25, warmupStartedAt: daysAgo(11) }), NOW)).toBe(25)
    // And on day 1 the floor (10) is still below 25, so it returns 10.
    expect(effectiveDailyLimit(mb({ dailyLimit: 25, warmupStartedAt: NOW }), NOW)).toBe(10)
  })

  it('a small dailyLimit reaches full ramp early', () => {
    // dailyLimit 30: day 3 ramp cap is 30 → effective 30 (== limit), warmed.
    expect(effectiveDailyLimit(mb({ dailyLimit: 30, warmupStartedAt: daysAgo(2) }), NOW)).toBe(30)
  })
})

describe('isWarmingUp', () => {
  it('is true while the effective limit is below dailyLimit', () => {
    expect(isWarmingUp(mb({ dailyLimit: 500, warmupStartedAt: NOW }), NOW)).toBe(true)
  })

  it('is false once the ramp meets dailyLimit', () => {
    expect(isWarmingUp(mb({ dailyLimit: 30, warmupStartedAt: daysAgo(2) }), NOW)).toBe(false)
  })

  it('is false when warmup is disabled', () => {
    expect(isWarmingUp(mb({ warmupEnabled: false, warmupStartedAt: NOW }), NOW)).toBe(false)
  })
})
