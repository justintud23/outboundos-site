import { describe, it, expect } from 'vitest'
import { mailboxReadiness, isDomainUsable } from './readiness'

const NOW = new Date('2026-09-25T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000)
const base = {
  mailbox: { dailyLimit: 30, warmupEnabled: true, warmupStartedAt: daysAgo(40), rampPreset: 'CONSERVATIVE' as const, isActive: true, autoPaused: false, pauseReason: null },
  domain: { status: 'HEALTHY' as const, registeredAt: daysAgo(400) },
  sent14: 100, bounces14: 1, now: NOW,
}

describe('isDomainUsable', () => {
  it('only HEALTHY and WARNING', () => {
    expect(['HEALTHY', 'WARNING', 'FAILING', 'UNVERIFIED', null].map((s) => isDomainUsable(s as never))).toEqual([true, true, false, false, false])
  })
})

describe('mailboxReadiness', () => {
  it('READY when ramped, old domain, healthy, low bounces', () => {
    expect(mailboxReadiness(base).state).toBe('READY')
  })
  it('PAUSED wins over everything, with the reason', () => {
    const r = mailboxReadiness({ ...base, mailbox: { ...base.mailbox, autoPaused: true, pauseReason: 'Bounce rate 6%' } })
    expect(r).toMatchObject({ state: 'PAUSED', detail: 'Bounce rate 6%' })
  })
  it('BLOCKED when the domain is failing or unverified (or has no row)', () => {
    expect(mailboxReadiness({ ...base, domain: { ...base.domain, status: 'FAILING' } }).state).toBe('BLOCKED')
    expect(mailboxReadiness({ ...base, domain: { ...base.domain, status: 'UNVERIFIED' } }).detail).toMatch(/not verified/i)
    expect(mailboxReadiness({ ...base, domain: null }).state).toBe('BLOCKED')
  })
  it('NEEDS_ATTENTION at ≥2% bounces with ≥20 sends; ignored under 20 sends', () => {
    expect(mailboxReadiness({ ...base, sent14: 50, bounces14: 1 }).state).toBe('NEEDS_ATTENTION')
    expect(mailboxReadiness({ ...base, sent14: 10, bounces14: 3 }).state).toBe('READY')
  })
  it('RAMPING with ready date = the day the preset reaches full', () => {
    const r = mailboxReadiness({ ...base, mailbox: { ...base.mailbox, warmupStartedAt: daysAgo(4) } })
    expect(r.state).toBe('RAMPING')
    // Started 4 days ago = day 5; Conservative full on day 29 → 24 more days.
    expect(r.readyOn?.toISOString().slice(0, 10)).toBe(new Date(NOW.getTime() + 24 * 86_400_000).toISOString().slice(0, 10))
  })
  it('RAMPING until the domain turns 30 days old if that is later', () => {
    const r = mailboxReadiness({ ...base, domain: { status: 'HEALTHY', registeredAt: daysAgo(5) } })
    expect(r.state).toBe('RAMPING')
    expect(r.readyOn?.toISOString().slice(0, 10)).toBe(new Date(daysAgo(5).getTime() + 30 * 86_400_000).toISOString().slice(0, 10))
  })
  it('RAMPING with no date when the domain age is unknown', () => {
    const r = mailboxReadiness({ ...base, domain: { status: 'HEALTHY', registeredAt: null } })
    expect(r).toMatchObject({ state: 'RAMPING', readyOn: null })
    expect(r.detail).toMatch(/domain age unknown/i)
  })
  it('ramp off on an old healthy domain is READY', () => {
    expect(mailboxReadiness({ ...base, mailbox: { ...base.mailbox, warmupEnabled: false, warmupStartedAt: NOW } }).state).toBe('READY')
  })
})
