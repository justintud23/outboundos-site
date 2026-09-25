import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findMany: vi.fn(), updateMany: vi.fn() },
    organization: { updateMany: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/features/replies/server/notify', () => ({ sendOrgAlert: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { verifyPendingLeads } from './verify-leads'
import type { EmailVerifier, VerifyOutcome } from '../provider'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { lead: { findMany: Fn; updateMany: Fn }; organization: { updateMany: Fn; update: Fn } }
const alert = sendOrgAlert as unknown as Fn
const T0 = new Date('2026-10-01T12:00:00Z').getTime()
const lead = (id: string, o: Record<string, unknown> = {}) => ({ id, organizationId: 'org-1', email: `${id}@acme.com`, emailCheckAttempts: 0, ...o })
const verifier = (fn: (email: string) => VerifyOutcome | Promise<VerifyOutcome>): EmailVerifier => ({ verify: vi.fn(async (e: string) => fn(e)) })

beforeEach(() => {
  vi.resetAllMocks()
  p.lead.updateMany.mockResolvedValue({ count: 1 })
  p.organization.updateMany.mockResolvedValue({ count: 1 })
  alert.mockResolvedValue(true)
})

describe('verifyPendingLeads', () => {
  it('skips entirely without a verifier', async () => {
    const res = await verifyPendingLeads(10_000, { verifier: null })
    expect(res).toEqual({ checked: 0, retried: 0, accountError: null, skipped: true })
    expect(p.lead.findMany).not.toHaveBeenCalled()
  })

  it('takes PENDING leads oldest-first and writes mapped results only while still PENDING (Review Focus #1, #3)', async () => {
    p.lead.findMany.mockResolvedValueOnce([lead('a'), lead('b'), lead('c')])
    const results: Record<string, VerifyOutcome> = {
      'a@acme.com': { kind: 'result', result: 'ok' },
      'b@acme.com': { kind: 'result', result: 'catch_all' },
      'c@acme.com': { kind: 'result', result: 'disposable' },
    }
    const res = await verifyPendingLeads(10_000, { verifier: verifier((e) => results[e]!), now: () => T0 })
    expect(p.lead.findMany.mock.calls[0]![0]).toMatchObject({ where: { emailCheck: 'PENDING' }, orderBy: { updatedAt: 'asc' } })
    expect(res.checked).toBe(3)
    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'a', emailCheck: 'PENDING' },
      data: { emailCheck: 'OK', emailCheckResult: 'ok', emailCheckedAt: new Date(T0), emailCheckAttempts: 0 },
    })
    expect(p.lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'b', emailCheck: 'PENDING' }, data: expect.objectContaining({ emailCheck: 'RISKY' }) }))
    expect(p.lead.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c', emailCheck: 'PENDING' }, data: expect.objectContaining({ emailCheck: 'INVALID', emailCheckResult: 'disposable' }) }))
  })

  it('counts a retry, and resolves to RISKY/unknown on the third attempt (Review Focus #3)', async () => {
    p.lead.findMany.mockResolvedValueOnce([lead('a', { emailCheckAttempts: 0 }), lead('b', { emailCheckAttempts: 2 })])
    const res = await verifyPendingLeads(10_000, { verifier: verifier(() => ({ kind: 'retry', reason: 'timeout' })), now: () => T0 })
    expect(res.retried).toBe(2)
    expect(p.lead.updateMany).toHaveBeenCalledWith({ where: { id: 'a', emailCheck: 'PENDING' }, data: { emailCheckAttempts: 1 } })
    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'b', emailCheck: 'PENDING' },
      data: { emailCheck: 'RISKY', emailCheckResult: 'unknown', emailCheckedAt: new Date(T0), emailCheckAttempts: 3 },
    })
  })

  it('never runs more than 5 checks at once', async () => {
    p.lead.findMany.mockResolvedValueOnce(Array.from({ length: 12 }, (_, i) => lead(`l${i}`)))
    let inFlight = 0
    let peak = 0
    const v = verifier(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return { kind: 'result', result: 'ok' }
    })
    const res = await verifyPendingLeads(10_000, { verifier: v })
    expect(res.checked).toBe(12)
    expect(peak).toBe(5)
  })

  it('starts no new check once the budget is spent, but lets in-flight ones finish (Review Focus #4)', async () => {
    p.lead.findMany.mockResolvedValueOnce(Array.from({ length: 10 }, (_, i) => lead(`l${i}`)))
    let clock = T0
    const v = verifier(() => {
      clock += 11_000 // each check "takes" 11 s
      return { kind: 'result', result: 'ok' }
    })
    const res = await verifyPendingLeads(10_000, { verifier: v, now: () => clock })
    // The first worker's check finishes past the budget; no worker starts another.
    expect((v.verify as Fn).mock.calls.length).toBeLessThanOrEqual(5)
    expect(res.checked).toBe((v.verify as Fn).mock.calls.length)
  })

  it('stops on an account error, leaves leads PENDING, and alerts each org with pending leads once', async () => {
    p.lead.findMany
      .mockResolvedValueOnce([lead('a'), lead('b', { organizationId: 'org-2' })])
      .mockResolvedValueOnce([{ organizationId: 'org-1' }, { organizationId: 'org-2' }])
    p.organization.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const v = verifier(() => ({ kind: 'account', reason: 'no_credits' }))
    const res = await verifyPendingLeads(10_000, { verifier: v, now: () => T0 })
    expect(res.accountError).toBe('no_credits')
    expect(p.lead.updateMany).not.toHaveBeenCalled()
    expect(p.lead.findMany.mock.calls[1]![0]).toMatchObject({ where: { emailCheck: 'PENDING' }, distinct: ['organizationId'] })
    expect(p.organization.updateMany).toHaveBeenCalledWith({
      where: { id: 'org-1', verificationAlertedAt: null },
      data: { verificationAlertedAt: new Date(T0), verificationPausedReason: 'out of MillionVerifier credits' },
    })
    // org-2 was already alerted for this outage (claim count 0): no second email.
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0]![0]).toBe('org-1')
    expect(alert.mock.calls[0]![1]).toBe('Email verification paused: out of MillionVerifier credits')
  })

  it('releases the alert claim when the alert email fails, so the next run retries it', async () => {
    p.lead.findMany.mockResolvedValueOnce([lead('a')]).mockResolvedValueOnce([{ organizationId: 'org-1' }])
    alert.mockResolvedValueOnce(false)
    await verifyPendingLeads(10_000, { verifier: verifier(() => ({ kind: 'account', reason: 'bad_key' })), now: () => T0 })
    expect(p.organization.update).toHaveBeenCalledWith({ where: { id: 'org-1' }, data: { verificationAlertedAt: null } })
  })

  it('clears an org\'s outage marker after a successful result', async () => {
    p.lead.findMany.mockResolvedValueOnce([lead('a')])
    await verifyPendingLeads(10_000, { verifier: verifier(() => ({ kind: 'result', result: 'ok' })), now: () => T0 })
    expect(p.organization.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['org-1'] },
        OR: [{ verificationAlertedAt: { not: null } }, { verificationPausedReason: { not: null } }],
      },
      data: { verificationAlertedAt: null, verificationPausedReason: null },
    })
  })

  it('clears verificationPausedReason on a later successful run even when the alert send failed and left the reason set (I-1)', async () => {
    // Run 1: account error, alert send fails -> claim released but verificationPausedReason stays set.
    p.lead.findMany.mockResolvedValueOnce([lead('a')]).mockResolvedValueOnce([{ organizationId: 'org-1' }])
    alert.mockResolvedValueOnce(false)
    await verifyPendingLeads(10_000, { verifier: verifier(() => ({ kind: 'account', reason: 'bad_key' })), now: () => T0 })
    expect(p.organization.update).toHaveBeenCalledWith({ where: { id: 'org-1' }, data: { verificationAlertedAt: null } })

    vi.clearAllMocks()
    p.lead.updateMany.mockResolvedValue({ count: 1 })
    p.organization.updateMany.mockResolvedValue({ count: 1 })

    // Run 2: a successful result for org-1 must still clear verificationPausedReason,
    // even though verificationAlertedAt is already null.
    p.lead.findMany.mockResolvedValueOnce([lead('a')])
    await verifyPendingLeads(10_000, { verifier: verifier(() => ({ kind: 'result', result: 'ok' })), now: () => T0 })
    expect(p.organization.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['org-1'] },
        OR: [{ verificationAlertedAt: { not: null } }, { verificationPausedReason: { not: null } }],
      },
      data: { verificationAlertedAt: null, verificationPausedReason: null },
    })
  })
})
