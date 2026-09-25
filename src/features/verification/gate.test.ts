import { describe, it, expect } from 'vitest'
import { checkFromResult, isFreshResult, verificationGate, VERIFY_MAX_AGE_DAYS } from './gate'

const NOW = new Date('2026-10-01T12:00:00Z')
const DAY = 86_400_000
const lead = (o: Partial<{ emailCheck: 'UNCHECKED' | 'PENDING' | 'OK' | 'RISKY' | 'INVALID'; emailCheckResult: string | null; emailCheckedAt: Date | null }> = {}) => ({
  emailCheck: 'OK' as const, emailCheckResult: 'ok', emailCheckedAt: new Date(NOW.getTime() - DAY), ...o,
})
const allowRisky = { blockRiskyEmails: false }
const blockRisky = { blockRiskyEmails: true }

describe('checkFromResult', () => {
  it.each([
    ['ok', 'OK'], ['catch_all', 'RISKY'], ['unknown', 'RISKY'], ['invalid', 'INVALID'], ['disposable', 'INVALID'],
  ] as const)('%s → %s', (result, check) => {
    expect(checkFromResult(result)).toBe(check)
  })
})

describe('verificationGate', () => {
  it('sends everything when no verifier is configured', () => {
    expect(verificationGate(lead({ emailCheck: 'UNCHECKED', emailCheckedAt: null }), allowRisky, false, NOW)).toEqual({ action: 'send' })
    expect(verificationGate(lead({ emailCheck: 'INVALID' }), allowRisky, false, NOW)).toEqual({ action: 'send' })
  })

  it('sends a fresh OK', () => {
    expect(verificationGate(lead(), allowRisky, true, NOW)).toEqual({ action: 'send' })
  })

  it('sends a fresh RISKY unless risky emails are blocked', () => {
    const risky = lead({ emailCheck: 'RISKY', emailCheckResult: 'catch_all' })
    expect(verificationGate(risky, allowRisky, true, NOW)).toEqual({ action: 'send' })
    expect(verificationGate(risky, blockRisky, true, NOW)).toEqual({
      action: 'stop', reason: 'Email is risky (catch-all/unknown) and risky emails are blocked',
    })
  })

  it('stops INVALID at any age, naming the result', () => {
    const old = lead({ emailCheck: 'INVALID', emailCheckResult: 'disposable', emailCheckedAt: new Date(NOW.getTime() - 400 * DAY) })
    expect(verificationGate(old, allowRisky, true, NOW)).toEqual({ action: 'stop', reason: 'Email failed verification (disposable)' })
  })

  it('waits on UNCHECKED, PENDING, and results older than 90 days', () => {
    expect(verificationGate(lead({ emailCheck: 'UNCHECKED', emailCheckedAt: null }), allowRisky, true, NOW)).toEqual({ action: 'wait' })
    expect(verificationGate(lead({ emailCheck: 'PENDING' }), allowRisky, true, NOW)).toEqual({ action: 'wait' })
    const stale = lead({ emailCheckedAt: new Date(NOW.getTime() - VERIFY_MAX_AGE_DAYS * DAY - 1) })
    expect(verificationGate(stale, allowRisky, true, NOW)).toEqual({ action: 'wait' })
  })

  it('treats exactly 90 days as still fresh', () => {
    const edge = lead({ emailCheckedAt: new Date(NOW.getTime() - VERIFY_MAX_AGE_DAYS * DAY) })
    expect(isFreshResult(edge, NOW)).toBe(true)
    expect(verificationGate(edge, allowRisky, true, NOW)).toEqual({ action: 'send' })
  })

  it('never treats PENDING or UNCHECKED as fresh even with a date', () => {
    expect(isFreshResult(lead({ emailCheck: 'PENDING' }), NOW)).toBe(false)
  })
})
