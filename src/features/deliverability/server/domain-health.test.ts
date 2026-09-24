import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    mailbox: { findMany: vi.fn() },
    organization: { findMany: vi.fn() },
    domainHealth: { createMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  },
}))
vi.mock('@/features/replies/server/notify', () => ({ sendOrgAlert: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { DnsLookupError } from './lookup-domain'
import { checkDomain, ensureDomainRows, refreshAllDomains, getDomainHealthMap, domainOf } from './domain-health'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { mailbox: { findMany: Fn }; organization: { findMany: Fn }; domainHealth: Record<string, Fn> }
const NOW = new Date('2026-09-25T12:00:00Z')
const GOOD = {
  txt: ['v=spf1 include:spf.protection.outlook.com -all'], dmarc: ['v=DMARC1; p=reject'],
  mx: ['a.mail.protection.outlook.com'], dkim: { selector1: 's1.x.onmicrosoft.com', selector2: 's2.x.onmicrosoft.com' },
}
const row = (o: Record<string, unknown> = {}) => ({
  id: 'dh-1', organizationId: 'org-1', domain: 'getacmesnow.com', status: 'UNVERIFIED', checks: null,
  registeredAt: new Date('2026-01-01'), registeredAtSource: 'rdap', lastCheckedAt: null, lastAttemptAt: null,
  lastStatusChangeAt: null, lastError: null, alertedStatus: null, ...o,
})
const deps = (o: Record<string, unknown> = {}) => ({ lookup: vi.fn().mockResolvedValue(GOOD), rdap: vi.fn().mockResolvedValue(null), now: () => NOW, ...o })

// Stateful fake row: findUnique returns it, update merges into it — so status
// and alertedStatus carry over between checks like the real table.
// updateMany performs the same compare-and-set semantics `maybeAlert` relies
// on: it only mutates (and reports count: 1) when the row still matches the
// where clause, which is how the concurrency tests below prove mutual
// exclusion without any real parallelism — the mock body never yields
// mid-check, so whichever call runs it first wins atomically.
let current: ReturnType<typeof row>

function matchesStatus(where: Record<string, unknown>): boolean {
  const status = where.status as string | { in?: string[] } | undefined
  if (status === undefined) return true
  if (typeof status === 'string') return current.status === status
  return (status.in ?? []).includes(current.status)
}

function matchesAlerted(where: Record<string, unknown>): boolean {
  const or = where.OR as { alertedStatus?: unknown }[] | undefined
  if (or) {
    return or.some((clause) => {
      if (clause.alertedStatus === null) return current.alertedStatus === null
      const notClause = clause.alertedStatus as { not?: unknown } | undefined
      return current.alertedStatus !== notClause?.not
    })
  }
  const alertedStatus = where.alertedStatus
  if (alertedStatus === undefined) return true
  return current.alertedStatus === alertedStatus
}

beforeEach(() => {
  vi.resetAllMocks()
  current = row()
  p.domainHealth.findUnique.mockImplementation(async () => current)
  p.domainHealth.update.mockImplementation(async ({ data }: { data: object }) => (current = { ...current, ...data }))
  p.domainHealth.updateMany.mockImplementation(async ({ where, data }: { where: Record<string, unknown>; data: object }) => {
    if (where.id !== current.id || !matchesStatus(where) || !matchesAlerted(where)) return { count: 0 }
    current = { ...current, ...data }
    return { count: 1 }
  })
  ;(sendOrgAlert as Fn).mockResolvedValue(true)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('domainOf', () => {
  it('lower-cased part after @', () => expect(domainOf('Mike@GetAcmeSnow.COM')).toBe('getacmesnow.com'))
})

describe('ensureDomainRows', () => {
  it('creates UNVERIFIED rows for the org’s Graph mailbox domains and returns never-attempted rows', async () => {
    p.mailbox.findMany.mockResolvedValue([{ email: 'a@x.com' }, { email: 'b@X.com' }, { email: 'c@y.com' }])
    p.domainHealth.findMany.mockResolvedValue([{ id: 'dh-x', domain: 'x.com' }])
    const out = await ensureDomainRows('org-1')
    expect(p.mailbox.findMany.mock.calls[0][0].where).toEqual({ organizationId: 'org-1', provider: 'MICROSOFT_GRAPH' })
    expect(p.domainHealth.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: 'org-1', domain: 'x.com' }, { organizationId: 'org-1', domain: 'y.com' }],
      skipDuplicates: true,
    })
    expect(out).toEqual([{ id: 'dh-x', domain: 'x.com' }])
  })
})

describe('checkDomain', () => {
  it('stores the evaluation, status change time, and clears lastError', async () => {
    await checkDomain('dh-1', deps())
    // calls[0] is the immediate lastAttemptAt stamp; calls[1] is the main update.
    expect(p.domainHealth.update.mock.calls[0][0].data).toEqual({ lastAttemptAt: NOW })
    expect(p.domainHealth.update.mock.calls[1][0].data).toMatchObject({
      status: 'HEALTHY', lastCheckedAt: NOW, lastAttemptAt: NOW, lastStatusChangeAt: NOW, lastError: null,
    })
  })

  it('looks up the registration date only while unknown, never over a manual date', async () => {
    current = row({ registeredAt: null, registeredAtSource: null })
    const d = deps({ rdap: vi.fn().mockResolvedValue(new Date('2026-09-01')) })
    await checkDomain('dh-1', d)
    expect(p.domainHealth.update.mock.calls[1][0].data).toMatchObject({ registeredAt: new Date('2026-09-01'), registeredAtSource: 'rdap' })

    current = row({ registeredAt: new Date('2026-02-01'), registeredAtSource: 'manual' })
    const d2 = deps()
    await checkDomain('dh-1', d2)
    expect(d2.rdap).not.toHaveBeenCalled()
  })

  it('Review Focus #2: DNS timeout on a HEALTHY domain keeps HEALTHY, records lastError, no alert', async () => {
    current = row({ status: 'HEALTHY', alertedStatus: null })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockRejectedValue(new DnsLookupError('ETIMEOUT', 'x')) }))
    const data = p.domainHealth.update.mock.calls[1][0].data
    expect(data).toMatchObject({ lastAttemptAt: NOW, lastError: expect.stringMatching(/couldn.t check/i) })
    expect(data).not.toHaveProperty('status')
    expect(sendOrgAlert).not.toHaveBeenCalled()
  })

  it('Review Focus #2: a timeout on a never-checked domain leaves it UNVERIFIED', async () => {
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockRejectedValue(new DnsLookupError('ESERVFAIL', 'x')) }))
    expect(p.domainHealth.update.mock.calls[1][0].data).not.toHaveProperty('status')
  })

  it('Review Focus #3: one alert on turning FAILING; none on an unchanged recheck; one on recovery', async () => {
    const failing = { ...GOOD, mx: [] }
    current = row({ status: 'HEALTHY', alertedStatus: null })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue(failing) }))
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect((sendOrgAlert as Fn).mock.calls[0][1]).toMatch(/getacmesnow\.com is failing/)
    expect((sendOrgAlert as Fn).mock.calls[0][2]).toMatch(/MX/)
    expect(current.alertedStatus).toBe('FAILING')

    ;(sendOrgAlert as Fn).mockClear()
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue(failing) }))
    expect(sendOrgAlert).not.toHaveBeenCalled()

    ;(sendOrgAlert as Fn).mockClear()
    await checkDomain('dh-1', deps())
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect((sendOrgAlert as Fn).mock.calls[0][1]).toMatch(/recovered/)
    expect(current.alertedStatus).toBe('HEALTHY')
  })

  it('a failed alert leaves alertedStatus unchanged so it retries next check', async () => {
    ;(sendOrgAlert as Fn).mockResolvedValue(false)
    current = row({ status: 'HEALTHY', alertedStatus: null })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue({ ...GOOD, mx: [] }) }))
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect(current.status).toBe('FAILING')
    expect(current.alertedStatus).toBeNull()
  })

  it('a failed recovery send leaves alertedStatus at FAILING so it retries next check', async () => {
    ;(sendOrgAlert as Fn).mockResolvedValue(false)
    current = row({ status: 'FAILING', alertedStatus: 'FAILING' })
    await checkDomain('dh-1', deps())
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect((sendOrgAlert as Fn).mock.calls[0][1]).toMatch(/recovered/)
    expect(current.status).toBe('HEALTHY')
    expect(current.alertedStatus).toBe('FAILING')
  })

  it('a successful recovery send persists alertedStatus as the new status', async () => {
    current = row({ status: 'FAILING', alertedStatus: 'FAILING' })
    await checkDomain('dh-1', deps())
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect(current.status).toBe('HEALTHY')
    expect(current.alertedStatus).toBe('HEALTHY')
  })

  it('alerts again after FAILING → recovered → FAILING', async () => {
    const failing = { ...GOOD, mx: [] }
    const warningOnly = { ...GOOD, dmarc: [] } // DMARC-only warn → status WARNING, not FAILING
    current = row({ status: 'FAILING', alertedStatus: 'FAILING' })

    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue(warningOnly) }))
    expect(current.status).toBe('WARNING')
    expect(current.alertedStatus).toBe('WARNING')
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect((sendOrgAlert as Fn).mock.calls[0][1]).toMatch(/recovered/)

    ;(sendOrgAlert as Fn).mockClear()
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue(failing) }))
    expect(current.status).toBe('FAILING')
    expect(current.alertedStatus).toBe('FAILING')
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect((sendOrgAlert as Fn).mock.calls[0][1]).toMatch(/getacmesnow\.com is failing/)
  })

  it('maybeAlert throwing (e.g. the send or its claim) still lets checkDomain resolve with the persisted row', async () => {
    current = row({ status: 'HEALTHY', alertedStatus: null })
    ;(sendOrgAlert as Fn).mockRejectedValue(new Error('smtp down'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const failing = { ...GOOD, mx: [] }
    const result = await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue(failing) }))
    expect(result.status).toBe('FAILING')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('maybeAlert failed'), expect.any(Error))
  })

  it('two concurrent checkDomain calls on the same newly-failing domain alert only once', async () => {
    current = row({ status: 'HEALTHY', alertedStatus: null })
    const failing = { ...GOOD, mx: [] }
    const d1 = deps({ lookup: vi.fn().mockResolvedValue(failing) })
    const d2 = deps({ lookup: vi.fn().mockResolvedValue(failing) })
    await Promise.all([checkDomain('dh-1', d1), checkDomain('dh-1', d2)])
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect(current.status).toBe('FAILING')
    expect(current.alertedStatus).toBe('FAILING')
  })
})

describe('refreshAllDomains', () => {
  it('ensures rows for connected orgs, then checks oldest attempt first', async () => {
    p.organization.findMany.mockResolvedValue([{ id: 'org-1' }])
    p.mailbox.findMany.mockResolvedValue([{ organizationId: 'org-1', email: 'a@x.com' }, { organizationId: 'org-1', email: 'b@y.com' }])
    p.domainHealth.findMany
      .mockResolvedValueOnce([]) // ensureDomainRows' never-attempted query
      .mockResolvedValueOnce([
        { id: 'dh-1', organizationId: 'org-1', domain: 'x.com' },
        { id: 'dh-2', organizationId: 'org-1', domain: 'y.com' },
      ])
    const out = await refreshAllDomains(25_000, deps())
    expect(p.domainHealth.findMany.mock.calls[1][0]).toMatchObject({ orderBy: { lastAttemptAt: { sort: 'asc', nulls: 'first' } } })
    expect(out).toEqual({ checked: 2, failed: 0 })
  })

  it('one domain throwing does not stop the rest', async () => {
    p.organization.findMany.mockResolvedValue([])
    p.mailbox.findMany.mockResolvedValue([{ organizationId: 'org-1', email: 'a@x.com' }, { organizationId: 'org-1', email: 'b@y.com' }])
    p.domainHealth.findMany.mockResolvedValue([
      { id: 'dh-1', organizationId: 'org-1', domain: 'x.com' },
      { id: 'dh-2', organizationId: 'org-1', domain: 'y.com' },
    ])
    p.domainHealth.findUnique.mockRejectedValueOnce(new Error('db blip'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await refreshAllDomains(25_000, deps())).toEqual({ checked: 1, failed: 1 })
  })

  it('one org’s ensureDomainRows throwing does not stop the other org’s domains from being checked', async () => {
    p.organization.findMany.mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }])
    p.mailbox.findMany
      .mockRejectedValueOnce(new Error('db blip')) // ensureDomainRows('org-1')
      .mockResolvedValueOnce([{ email: 'b@y.com' }]) // ensureDomainRows('org-2')
      .mockResolvedValueOnce([{ organizationId: 'org-2', email: 'b@y.com' }]) // refreshAllDomains' activeDomains query
    p.domainHealth.findMany
      .mockResolvedValueOnce([]) // ensureDomainRows('org-2')'s never-attempted query
      .mockResolvedValueOnce([{ id: 'dh-2', organizationId: 'org-2', domain: 'y.com' }]) // main rows query
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const out = await refreshAllDomains(25_000, deps())

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('org-1'), expect.any(Error))
    expect(p.domainHealth.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: 'org-2', domain: 'y.com' }],
      skipDuplicates: true,
    })
    expect(out).toEqual({ checked: 1, failed: 0 })
  })

  it('skips a row whose domain no longer has a Graph mailbox (orphaned, left alone)', async () => {
    p.organization.findMany.mockResolvedValue([{ id: 'org-1' }])
    p.mailbox.findMany.mockResolvedValue([{ organizationId: 'org-1', email: 'a@x.com' }]) // only x.com still connected
    p.domainHealth.findMany
      .mockResolvedValueOnce([]) // ensureDomainRows' never-attempted query
      .mockResolvedValueOnce([
        { id: 'dh-1', organizationId: 'org-1', domain: 'x.com' },
        { id: 'dh-2', organizationId: 'org-1', domain: 'orphaned.com' },
      ])
    const out = await refreshAllDomains(25_000, deps())
    expect(out).toEqual({ checked: 1, failed: 0 })
    expect(p.domainHealth.findUnique).toHaveBeenCalledTimes(1)
  })
})

describe('getDomainHealthMap', () => {
  it('maps domain → status and age', async () => {
    p.domainHealth.findMany.mockResolvedValue([{ domain: 'x.com', status: 'HEALTHY', registeredAt: null }])
    const m = await getDomainHealthMap('org-1')
    expect(m.get('x.com')).toEqual({ status: 'HEALTHY', registeredAt: null })
  })
})
