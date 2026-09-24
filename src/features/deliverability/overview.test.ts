import { describe, it, expect } from 'vitest'
import { buildOverview, dayKey, lastNDays, type OverviewInput } from './overview'

const NOW = new Date('2026-09-25T16:00:00Z') // 12:00 ET
const TZ = 'America/New_York'
const d = (iso: string) => new Date(iso)

const input = (o: Partial<OverviewInput> = {}): OverviewInput => ({
  now: NOW,
  timezone: TZ,
  mailboxes: [
    {
      id: 'mb-1', email: 'mike@acme.com', displayName: 'Mike', dailyLimit: 30, sentToday: 4, lastResetAt: NOW,
      warmupEnabled: true, warmupStartedAt: new Date(NOW.getTime() - 40 * 86_400_000), rampPreset: 'CONSERVATIVE',
      isActive: true, autoPaused: false, pauseReason: null,
    },
  ],
  domains: [
    { id: 'dh-1', domain: 'acme.com', status: 'HEALTHY', checks: [], registeredAt: d('2024-01-01'), registeredAtSource: 'rdap', lastCheckedAt: NOW, lastError: null },
  ],
  sends: [
    { mailboxId: 'mb-1', sentAt: d('2026-09-25T03:30:00Z') }, // 23:30 ET on 09-24
    { mailboxId: 'mb-1', sentAt: d('2026-09-25T14:00:00Z') }, // 10:00 ET on 09-25
  ],
  bounces: [{ mailboxId: 'mb-1', at: d('2026-09-25T15:00:00Z') }],
  replies: [{ mailboxId: 'mb-1', at: d('2026-09-25T15:30:00Z') }],
  queuedNext24h: 7,
  ...o,
})

describe('dayKey / lastNDays', () => {
  it('Review Focus #5: buckets by the org timezone, not UTC', () => {
    expect(dayKey(d('2026-09-25T03:30:00Z'), TZ)).toBe('2026-09-24')
  })
  it('14 consecutive days ending today', () => {
    const days = lastNDays(NOW, TZ)
    expect(days).toHaveLength(14)
    expect(days[13]).toBe('2026-09-25')
    expect(days[0]).toBe('2026-09-12')
  })
})

describe('buildOverview', () => {
  it('trend counts per org-timezone day', () => {
    const o = buildOverview(input())
    expect(o.trend.find((t) => t.day === '2026-09-24')).toEqual({ day: '2026-09-24', sent: 1, bounces: 0, replies: 0 })
    expect(o.trend.find((t) => t.day === '2026-09-25')).toEqual({ day: '2026-09-25', sent: 1, bounces: 1, replies: 1 })
    expect(o.trendByMailbox['mb-1']).toHaveLength(14)
  })
  it('mailbox row: ramp, limits, rates and readiness', () => {
    const row = buildOverview(input()).mailboxes[0]!
    expect(row).toMatchObject({ domain: 'acme.com', domainStatus: 'HEALTHY', todayLimit: 30, sentToday: 4, sent14: 2, bounces14: 1, replies14: 1, bounceRate: 0.5, replyRate: 0.5, state: 'READY' })
  })
  it('sentToday is 0 after the daily reset boundary', () => {
    const row = buildOverview(input({ mailboxes: [{ ...input().mailboxes[0]!, lastResetAt: new Date(NOW.getTime() - 2 * 86_400_000) }] })).mailboxes[0]!
    expect(row.sentToday).toBe(0)
  })
  it('summary: counts, capacity over usable mailboxes only, zero-safe rates', () => {
    const o = buildOverview(input({ sends: [], bounces: [], replies: [] }))
    expect(o.summary).toMatchObject({ capacityToday: 30, queuedNext24h: 7, sent14: 0, bounceRate14: 0, replyRate14: 0 })
    expect(o.summary.domains.HEALTHY).toBe(1)
    expect(o.summary.mailboxes.READY).toBe(1)

    const blocked = buildOverview(input({ domains: [{ ...input().domains[0]!, status: 'FAILING' }] }))
    expect(blocked.summary.capacityToday).toBe(0)
    expect(blocked.mailboxes[0]!.state).toBe('BLOCKED')
  })
  it('domain rows flag young domains and parse checks', () => {
    const young = buildOverview(input({ domains: [{ ...input().domains[0]!, registeredAt: new Date(NOW.getTime() - 3 * 86_400_000) }] }))
    expect(young.domains[0]!.young).toBe(true)
    expect(young.mailboxes[0]!.todayLimit).toBe(10)
  })
})
