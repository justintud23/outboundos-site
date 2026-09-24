import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    mailbox: { findMany: vi.fn() },
    organization: { findMany: vi.fn() },
    domainHealth: { createMany: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
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
let current: ReturnType<typeof row>
beforeEach(() => {
  vi.resetAllMocks()
  current = row()
  p.domainHealth.findUnique.mockImplementation(async () => current)
  p.domainHealth.update.mockImplementation(async ({ data }: { data: object }) => (current = { ...current, ...data }))
  ;(sendOrgAlert as Fn).mockResolvedValue(true)
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
    expect(p.domainHealth.update.mock.calls[0][0].data).toMatchObject({
      status: 'HEALTHY', lastCheckedAt: NOW, lastAttemptAt: NOW, lastStatusChangeAt: NOW, lastError: null,
    })
  })

  it('looks up the registration date only while unknown, never over a manual date', async () => {
    current = row({ registeredAt: null, registeredAtSource: null })
    const d = deps({ rdap: vi.fn().mockResolvedValue(new Date('2026-09-01')) })
    await checkDomain('dh-1', d)
    expect(p.domainHealth.update.mock.calls[0][0].data).toMatchObject({ registeredAt: new Date('2026-09-01'), registeredAtSource: 'rdap' })

    current = row({ registeredAt: new Date('2026-02-01'), registeredAtSource: 'manual' })
    const d2 = deps()
    await checkDomain('dh-1', d2)
    expect(d2.rdap).not.toHaveBeenCalled()
  })

  it('Review Focus #2: DNS timeout on a HEALTHY domain keeps HEALTHY, records lastError, no alert', async () => {
    current = row({ status: 'HEALTHY', alertedStatus: null })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockRejectedValue(new DnsLookupError('ETIMEOUT', 'x')) }))
    const data = p.domainHealth.update.mock.calls[0][0].data
    expect(data).toMatchObject({ lastAttemptAt: NOW, lastError: expect.stringMatching(/couldn.t check/i) })
    expect(data).not.toHaveProperty('status')
    expect(sendOrgAlert).not.toHaveBeenCalled()
  })

  it('Review Focus #2: a timeout on a never-checked domain leaves it UNVERIFIED', async () => {
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockRejectedValue(new DnsLookupError('ESERVFAIL', 'x')) }))
    expect(p.domainHealth.update.mock.calls[0][0].data).not.toHaveProperty('status')
  })

  it('Review Focus #3: one alert on turning FAILING; none on an unchanged recheck; one on recovery', async () => {
    const failing = { ...GOOD, mx: [] }
    current = row({ status: 'HEALTHY' })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue(failing) }))
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect((sendOrgAlert as Fn).mock.calls[0][1]).toMatch(/getacmesnow\.com is failing/)
    expect((sendOrgAlert as Fn).mock.calls[0][2]).toMatch(/MX/)
    expect(p.domainHealth.update).toHaveBeenLastCalledWith({ where: { id: 'dh-1' }, data: { alertedStatus: 'FAILING' } })

    ;(sendOrgAlert as Fn).mockClear()
    current = row({ status: 'FAILING', alertedStatus: 'FAILING' })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue(failing) }))
    expect(sendOrgAlert).not.toHaveBeenCalled()

    current = row({ status: 'FAILING', alertedStatus: 'FAILING' })
    await checkDomain('dh-1', deps())
    expect(sendOrgAlert).toHaveBeenCalledTimes(1)
    expect((sendOrgAlert as Fn).mock.calls[0][1]).toMatch(/recovered/)
  })

  it('a failed alert leaves alertedStatus unchanged so it retries next check', async () => {
    ;(sendOrgAlert as Fn).mockResolvedValue(false)
    current = row({ status: 'HEALTHY' })
    await checkDomain('dh-1', deps({ lookup: vi.fn().mockResolvedValue({ ...GOOD, mx: [] }) }))
    expect(p.domainHealth.update).toHaveBeenCalledTimes(1)
  })
})

describe('refreshAllDomains', () => {
  it('ensures rows for connected orgs, then checks oldest attempt first', async () => {
    p.organization.findMany.mockResolvedValue([{ id: 'org-1' }])
    p.mailbox.findMany.mockResolvedValue([])
    p.domainHealth.findMany.mockResolvedValueOnce([]) // ensureDomainRows' never-attempted query
      .mockResolvedValueOnce([{ id: 'dh-1' }, { id: 'dh-2' }])
    const out = await refreshAllDomains(25_000, deps())
    expect(p.domainHealth.findMany.mock.calls[1][0]).toMatchObject({ orderBy: { lastAttemptAt: { sort: 'asc', nulls: 'first' } } })
    expect(out).toEqual({ checked: 2, failed: 0 })
  })
  it('one domain throwing does not stop the rest', async () => {
    p.organization.findMany.mockResolvedValue([])
    p.domainHealth.findMany.mockResolvedValue([{ id: 'dh-1' }, { id: 'dh-2' }])
    p.domainHealth.findUnique.mockRejectedValueOnce(new Error('db blip'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await refreshAllDomains(25_000, deps())).toEqual({ checked: 1, failed: 1 })
  })
})

describe('getDomainHealthMap', () => {
  it('maps domain → status and age', async () => {
    p.domainHealth.findMany.mockResolvedValue([{ domain: 'x.com', status: 'HEALTHY', registeredAt: null }])
    const m = await getDomainHealthMap('org-1')
    expect(m.get('x.com')).toEqual({ status: 'HEALTHY', registeredAt: null })
  })
})
