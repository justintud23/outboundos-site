import { describe, it, expect } from 'vitest'
import { effectiveDailyLimit, warmupDay, isWarmingUp, presetCapForDay, rampFullDay, isYoungDomain } from './warmup'

const NOW = new Date('2026-09-25T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
// Ramp day N ⇔ warmupStartedAt = N-1 days ago.
const onDay = (n: number) => daysAgo(n - 1)
const OLD = { registeredAt: daysAgo(400) }
const mb = (o: Partial<{ dailyLimit: number; warmupEnabled: boolean; warmupStartedAt: Date; rampPreset: 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE' }> = {}) => ({
  dailyLimit: 30, warmupEnabled: true, warmupStartedAt: NOW, rampPreset: 'CONSERVATIVE' as const, ...o,
})

describe('warmupDay', () => {
  it('is day 1 on the start day and counts calendar days', () => {
    expect(warmupDay(NOW, NOW)).toBe(1)
    expect(warmupDay(daysAgo(2), NOW)).toBe(3)
    expect(warmupDay(new Date(NOW.getTime() + 86_400_000), NOW)).toBe(1)
  })
})

describe('presetCapForDay (Review Focus #4: every boundary)', () => {
  it.each([
    ['CONSERVATIVE', [[1, 3], [3, 3], [4, 5], [7, 5], [8, 10], [14, 10], [15, 18], [21, 18], [22, 25], [28, 25], [29, Infinity]]],
    ['STANDARD', [[1, 5], [3, 5], [4, 10], [7, 10], [8, 18], [14, 18], [15, 25], [21, 25], [22, Infinity]]],
    ['AGGRESSIVE', [[1, 10], [3, 10], [4, 18], [7, 18], [8, 25], [14, 25], [15, Infinity]]],
  ] as const)('%s', (preset, pairs) => {
    for (const [day, cap] of pairs) expect(presetCapForDay(preset, day)).toBe(cap)
  })
  it('full on day 29 / 22 / 15', () => {
    expect([rampFullDay('CONSERVATIVE'), rampFullDay('STANDARD'), rampFullDay('AGGRESSIVE')]).toEqual([29, 22, 15])
  })
})

describe('effectiveDailyLimit', () => {
  it('applies the preset cap, never above dailyLimit', () => {
    expect(effectiveDailyLimit(mb({ warmupStartedAt: onDay(1) }), NOW, OLD)).toBe(3)
    expect(effectiveDailyLimit(mb({ warmupStartedAt: onDay(22) }), NOW, OLD)).toBe(25)
    expect(effectiveDailyLimit(mb({ warmupStartedAt: onDay(29) }), NOW, OLD)).toBe(30)
    expect(effectiveDailyLimit(mb({ warmupStartedAt: onDay(15), dailyLimit: 12 }), NOW, OLD)).toBe(12)
  })
  it('defaults to CONSERVATIVE when rampPreset is absent', () => {
    const { rampPreset: _omit, ...legacy } = mb({ warmupStartedAt: onDay(4) })
    expect(effectiveDailyLimit(legacy, NOW, OLD)).toBe(5)
  })
  it('ramp off → full dailyLimit (no domain row → no young rule)', () => {
    expect(effectiveDailyLimit(mb({ warmupEnabled: false }), NOW)).toBe(30)
  })
  it('young domain caps at 10 whatever the preset or ramp setting', () => {
    const young = { registeredAt: daysAgo(10) }
    expect(effectiveDailyLimit(mb({ rampPreset: 'AGGRESSIVE', warmupStartedAt: onDay(20) }), NOW, young)).toBe(10)
    expect(effectiveDailyLimit(mb({ warmupEnabled: false }), NOW, young)).toBe(10)
    expect(effectiveDailyLimit(mb({ warmupStartedAt: onDay(1) }), NOW, young)).toBe(3)
  })
  it('unknown registration date counts as young; exactly 30 days is not young', () => {
    expect(effectiveDailyLimit(mb({ warmupEnabled: false }), NOW, { registeredAt: null })).toBe(10)
    expect(isYoungDomain({ registeredAt: daysAgo(30) }, NOW)).toBe(false)
    expect(isYoungDomain({ registeredAt: daysAgo(29) }, NOW)).toBe(true)
    expect(isYoungDomain(null, NOW)).toBe(false)
  })
  it('isWarmingUp is true while today is below dailyLimit', () => {
    expect(isWarmingUp(mb({ warmupStartedAt: onDay(1) }), NOW, OLD)).toBe(true)
    expect(isWarmingUp(mb({ warmupStartedAt: onDay(40) }), NOW, OLD)).toBe(false)
  })
})
