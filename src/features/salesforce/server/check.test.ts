import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    salesforceConnection: { update: vi.fn() },
    sequenceEnrollment: { updateMany: vi.fn() },
    draft: { updateMany: vi.fn() },
    outboundMessage: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('./connection', () => ({ getConnection: vi.fn(), isSalesforceActive: vi.fn() }))
vi.mock('./client', () => ({ getSalesforceClient: vi.fn() }))
vi.mock('./records', () => ({ lookupByEmails: vi.fn() }))
vi.mock('@/features/replies/server/notify', () => ({ sendOrgAlert: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { getConnection, isSalesforceActive } from './connection'
import { getSalesforceClient } from './client'
import { lookupByEmails } from './records'
import { sendOrgAlert } from '@/features/replies/server/notify'
import {
  ensureSalesforceClear, applySalesforceBlock, prefetchSalesforceChecks, resetLookupFailureMemoForTests,
  SF_FRESH_MS, SF_STALE_OK_MS, SF_LOOKUP_BACKOFF_MS,
} from './check'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  lead: { findMany: Fn; update: Fn; updateMany: Fn; count: Fn }
  salesforceConnection: { update: Fn }
  sequenceEnrollment: { updateMany: Fn }
  draft: { updateMany: Fn }
  outboundMessage: { updateMany: Fn }
  $transaction: Fn
}
const mockGetConnection = getConnection as unknown as Fn
const mockIsSalesforceActive = isSalesforceActive as unknown as Fn
const mockGetSalesforceClient = getSalesforceClient as unknown as Fn
const mockLookupByEmails = lookupByEmails as unknown as Fn
const mockSendOrgAlert = sendOrgAlert as unknown as Fn

const NOW = new Date('2026-09-29T12:00:00.000Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000)
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

interface ConnOverrides {
  status?: string
  heldAlertedAt?: Date | null
  customerAccountTypes?: string[]
  blockOpenOpportunities?: boolean
}
function baseConn(overrides: ConnOverrides = {}) {
  return {
    id: 'conn-1',
    organizationId: 'org-1',
    status: 'CONNECTED',
    rateLimitedUntil: null,
    customerAccountTypes: ['Customer'],
    blockOpenOpportunities: true,
    heldAlertedAt: null,
    ...overrides,
  }
}

interface LeadOverrides {
  id?: string
  organizationId?: string
  email?: string
  salesforceId?: string | null
  sfCheckStatus?: string | null
  sfCheckDetail?: string | null
  sfCheckedAt?: Date | null
  sfBlockOverride?: boolean
  sfHeldSince?: Date | null
}
function leadRow(overrides: LeadOverrides = {}) {
  return {
    id: 'lead-x',
    organizationId: 'org-1',
    email: 'x@acme.com',
    salesforceId: null,
    sfCheckStatus: null,
    sfCheckDetail: null,
    sfCheckedAt: null,
    sfBlockOverride: false,
    sfHeldSince: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetLookupFailureMemoForTests()
  mockIsSalesforceActive.mockReturnValue(true)
  p.lead.update.mockResolvedValue({})
  p.lead.updateMany.mockResolvedValue({ count: 0 })
  p.lead.count.mockResolvedValue(0)
  p.salesforceConnection.update.mockResolvedValue({})
  p.sequenceEnrollment.updateMany.mockReturnValue('enrollment-op')
  p.draft.updateMany.mockReturnValue('draft-op')
  p.outboundMessage.updateMany.mockReturnValue('message-op')
  p.$transaction.mockImplementation(async (ops: unknown) => ops)
  mockSendOrgAlert.mockResolvedValue(true)
})

describe('ensureSalesforceClear - no connection', () => {
  it('allows every lead and never looks anything up when there is no connection row', async () => {
    mockGetConnection.mockResolvedValue(null)

    const result = await ensureSalesforceClear('org-1', ['lead-1', 'lead-2'], NOW)

    expect(result.allowed).toEqual(new Set(['lead-1', 'lead-2']))
    expect(result.held.size).toBe(0)
    expect(result.blocked.size).toBe(0)
    expect(p.lead.findMany).not.toHaveBeenCalled()
    expect(mockLookupByEmails).not.toHaveBeenCalled()
  })
})

describe('ensureSalesforceClear - override', () => {
  it('allows a lead with sfBlockOverride even with a blocking stored status', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    p.lead.findMany.mockResolvedValue([
      leadRow({ id: 'lead-1', sfBlockOverride: true, sfCheckStatus: 'CUSTOMER', sfCheckDetail: 'Acme', sfCheckedAt: hoursAgo(1) }),
    ])

    const result = await ensureSalesforceClear('org-1', ['lead-1'], NOW)

    expect(result.allowed.has('lead-1')).toBe(true)
    expect(result.blocked.size).toBe(0)
    expect(mockLookupByEmails).not.toHaveBeenCalled()
  })
})

describe('ensureSalesforceClear - fresh cache (under 24h)', () => {
  it('blocks a fresh CUSTOMER with the classified reason, and allows a fresh CLEAR, with no lookup', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    p.lead.findMany.mockResolvedValue([
      leadRow({ id: 'lead-cust', sfCheckStatus: 'CUSTOMER', sfCheckDetail: 'Acme', sfCheckedAt: hoursAgo(1) }),
      leadRow({ id: 'lead-clear', sfCheckStatus: 'CLEAR', sfCheckDetail: null, sfCheckedAt: hoursAgo(1) }),
    ])

    const result = await ensureSalesforceClear('org-1', ['lead-cust', 'lead-clear'], NOW)

    expect(result.blocked.get('lead-cust')).toBe('Salesforce: customer (Acme)')
    expect(result.allowed.has('lead-clear')).toBe(true)
    expect(mockLookupByEmails).not.toHaveBeenCalled()
  })
})

describe('ensureSalesforceClear - stale cache, active connection', () => {
  it('looks up all stale (3-day) leads in one batch call, writes the result, and only links when unset', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(true)
    mockGetSalesforceClient.mockReturnValue({ orgId: 'org-1' })
    p.lead.findMany.mockResolvedValue([
      leadRow({ id: 'lead-a', email: 'a@acme.com', salesforceId: null, sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3) }),
      leadRow({ id: 'lead-b', email: 'b@acme.com', salesforceId: '003existing', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3) }),
    ])
    mockLookupByEmails.mockResolvedValue(
      new Map([
        ['a@acme.com', { status: 'CLEAR', detail: null, person: { id: '003A', type: 'CONTACT', accountId: 'acc-1' } }],
        ['b@acme.com', { status: 'CLEAR', detail: null, person: { id: '003B', type: 'CONTACT', accountId: 'acc-2' } }],
      ]),
    )

    const result = await ensureSalesforceClear('org-1', ['lead-a', 'lead-b'], NOW)

    expect(mockLookupByEmails).toHaveBeenCalledTimes(1)
    expect(mockLookupByEmails.mock.calls[0][1]).toEqual(['a@acme.com', 'b@acme.com'])

    const updateA = p.lead.update.mock.calls.find((c: unknown[]) => (c[0] as { where: { id: string } }).where.id === 'lead-a')
    expect(updateA?.[0].data).toMatchObject({
      sfCheckStatus: 'CLEAR',
      sfCheckedAt: NOW,
      salesforceId: '003A',
      salesforceType: 'CONTACT',
      salesforceAccountId: 'acc-1',
    })

    const updateB = p.lead.update.mock.calls.find((c: unknown[]) => (c[0] as { where: { id: string } }).where.id === 'lead-b')
    expect(updateB?.[0].data).toMatchObject({ sfCheckStatus: 'CLEAR', sfCheckedAt: NOW })
    expect(updateB?.[0].data).not.toHaveProperty('salesforceId')

    expect(result.allowed).toEqual(new Set(['lead-a', 'lead-b']))
    // M1: sfHeldSince clearing is a separate, single batched write covering every decided lead.
    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['lead-a', 'lead-b'] }, sfHeldSince: { not: null } },
      data: { sfHeldSince: null },
    })
  })
})

describe('ensureSalesforceClear - lookup fails', () => {
  it('decides from a check under 7 days old, and holds the rest (setting sfHeldSince where unset)', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(true)
    mockGetSalesforceClient.mockReturnValue({ orgId: 'org-1' })
    mockLookupByEmails.mockRejectedValue(new Error('network timeout'))
    p.lead.findMany.mockResolvedValue([
      leadRow({ id: 'lead-recent', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3), sfHeldSince: null }),
      leadRow({ id: 'lead-old', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(8), sfHeldSince: null }),
      leadRow({ id: 'lead-never', sfCheckStatus: null, sfCheckedAt: null, sfHeldSince: null }),
    ])

    const result = await ensureSalesforceClear('org-1', ['lead-recent', 'lead-old', 'lead-never'], NOW)

    expect(result.allowed.has('lead-recent')).toBe(true)
    expect(result.held.has('lead-old')).toBe(true)
    expect(result.held.has('lead-never')).toBe(true)
    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['lead-old', 'lead-never'] } },
      data: { sfHeldSince: NOW },
    })
  })

  it('does not re-set sfHeldSince on a lead already held', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(true)
    mockGetSalesforceClient.mockReturnValue({ orgId: 'org-1' })
    mockLookupByEmails.mockRejectedValue(new Error('network timeout'))
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-already-held', sfCheckedAt: null, sfHeldSince: daysAgo(1) })])

    const result = await ensureSalesforceClear('org-1', ['lead-already-held'], NOW)

    expect(result.held.has('lead-already-held')).toBe(true)
    expect(p.lead.updateMany).not.toHaveBeenCalled()
  })
})

describe('ensureSalesforceClear - connection not active', () => {
  it('applies the stale/hold rule and never calls lookupByEmails when NEEDS_RECONNECT', async () => {
    mockGetConnection.mockResolvedValue(baseConn({ status: 'NEEDS_RECONNECT' }))
    mockIsSalesforceActive.mockReturnValue(false)
    p.lead.findMany.mockResolvedValue([
      leadRow({ id: 'lead-recent', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3) }),
      leadRow({ id: 'lead-never', sfCheckStatus: null, sfCheckedAt: null }),
    ])

    const result = await ensureSalesforceClear('org-1', ['lead-recent', 'lead-never'], NOW)

    expect(mockLookupByEmails).not.toHaveBeenCalled()
    expect(result.allowed.has('lead-recent')).toBe(true)
    expect(result.held.has('lead-never')).toBe(true)
  })
})

describe('ensureSalesforceClear - held alert', () => {
  it('sends one alert and stamps heldAlertedAt when leads are held past 24h and heldAlertedAt is null', async () => {
    mockGetConnection.mockResolvedValue(baseConn({ heldAlertedAt: null }))
    mockIsSalesforceActive.mockReturnValue(false)
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-never', sfCheckStatus: null, sfCheckedAt: null })])
    p.lead.count.mockResolvedValue(1)

    await ensureSalesforceClear('org-1', ['lead-never'], NOW)

    expect(p.lead.count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', sfHeldSince: { lt: new Date(NOW.getTime() - SF_FRESH_MS) } } })
    expect(mockSendOrgAlert).toHaveBeenCalledWith('org-1', 'Salesforce checks are holding emails', expect.any(String))
    expect(p.salesforceConnection.update).toHaveBeenCalledWith({ where: { organizationId: 'org-1' }, data: { heldAlertedAt: NOW } })
  })

  it('does not alert again when heldAlertedAt is 2 hours old', async () => {
    mockGetConnection.mockResolvedValue(baseConn({ heldAlertedAt: hoursAgo(2) }))
    mockIsSalesforceActive.mockReturnValue(false)
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-never', sfCheckStatus: null, sfCheckedAt: null })])
    p.lead.count.mockResolvedValue(1)

    await ensureSalesforceClear('org-1', ['lead-never'], NOW)

    expect(mockSendOrgAlert).not.toHaveBeenCalled()
    expect(p.salesforceConnection.update).not.toHaveBeenCalled()
  })

  it('does not alert when nothing is held', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-clear', sfCheckStatus: 'CLEAR', sfCheckedAt: hoursAgo(1) })])

    await ensureSalesforceClear('org-1', ['lead-clear'], NOW)

    expect(p.lead.count).not.toHaveBeenCalled()
    expect(mockSendOrgAlert).not.toHaveBeenCalled()
  })
})

describe('applySalesforceBlock', () => {
  it('runs the three updateMany calls inside one $transaction with the exact where clauses, passing exceptMessageId through', async () => {
    await applySalesforceBlock('org-1', 'lead-1', 'Salesforce: customer (Acme)', { exceptMessageId: 'msg-keep' })

    expect(p.sequenceEnrollment.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', leadId: 'lead-1', status: { in: ['ACTIVE', 'PAUSED'] } },
      data: { status: 'STOPPED', stoppedAt: expect.any(Date), stoppedReason: 'Salesforce: customer (Acme)', processing: false },
    })
    expect(p.draft.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        leadId: 'lead-1',
        status: { in: ['PENDING_REVIEW', 'APPROVED'] },
        outboundMessages: { none: { status: 'SENT' } },
      },
      data: { status: 'BLOCKED' },
    })
    expect(p.outboundMessage.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', leadId: 'lead-1', status: 'QUEUED', processing: false, id: { not: 'msg-keep' } },
      data: { status: 'CANCELLED', lastError: 'Salesforce: customer (Acme)' },
    })
    expect(p.$transaction).toHaveBeenCalledTimes(1)
    expect(p.$transaction.mock.calls[0][0]).toEqual(['enrollment-op', 'draft-op', 'message-op'])
  })

  it('omits the id filter on the outbound message update when exceptMessageId is not given', async () => {
    await applySalesforceBlock('org-1', 'lead-1', 'reason')

    const call = p.outboundMessage.updateMany.mock.calls.at(-1)
    expect(call?.[0].where).not.toHaveProperty('id')
  })
})

describe('prefetchSalesforceChecks', () => {
  it('groups leads by organization and calls ensureSalesforceClear once per org, swallowing an error from one org', async () => {
    p.lead.findMany.mockResolvedValue([
      { id: 'lead-1', organizationId: 'org-A' },
      { id: 'lead-2', organizationId: 'org-A' },
      { id: 'lead-3', organizationId: 'org-B' },
    ])
    mockGetConnection.mockImplementation(async (orgId: string) => {
      if (orgId === 'org-A') return null
      throw new Error('db unavailable')
    })

    await expect(prefetchSalesforceChecks(['lead-1', 'lead-2', 'lead-3'], NOW)).resolves.toBeUndefined()

    expect(mockGetConnection).toHaveBeenCalledTimes(2)
    expect(mockGetConnection).toHaveBeenCalledWith('org-A')
    expect(mockGetConnection).toHaveBeenCalledWith('org-B')
  })

  it('does nothing for an empty list', async () => {
    await prefetchSalesforceChecks([], NOW)
    expect(p.lead.findMany).not.toHaveBeenCalled()
  })

  it('passes each org only its own lead ids on to ensureSalesforceClear (M3(e))', async () => {
    p.lead.findMany.mockImplementation(async (args: { where: { id?: { in: string[] }; organizationId?: string } }) => {
      if (args.where.organizationId) {
        // The per-org findMany inside ensureSalesforceClear.
        const ids = args.where.id?.in ?? []
        return ids.map((id) => leadRow({ id, organizationId: args.where.organizationId }))
      }
      // The grouping findMany inside prefetchSalesforceChecks.
      return [
        { id: 'lead-1', organizationId: 'org-A' },
        { id: 'lead-2', organizationId: 'org-A' },
        { id: 'lead-3', organizationId: 'org-B' },
      ]
    })
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(false)

    await prefetchSalesforceChecks(['lead-1', 'lead-2', 'lead-3'], NOW)

    const orgACall = p.lead.findMany.mock.calls.find(
      (c: unknown[]) => (c[0] as { where: { organizationId?: string } }).where.organizationId === 'org-A',
    )
    const orgBCall = p.lead.findMany.mock.calls.find(
      (c: unknown[]) => (c[0] as { where: { organizationId?: string } }).where.organizationId === 'org-B',
    )
    expect(((orgACall?.[0] as { where: { id: { in: string[] } } }).where.id.in).sort()).toEqual(['lead-1', 'lead-2'])
    expect(((orgBCall?.[0] as { where: { id: { in: string[] } } }).where.id.in).sort()).toEqual(['lead-3'])
  })
})

describe('ensureSalesforceClear - I1: a DB write failure after a successful lookup', () => {
  it('rejects instead of returning, so a lead the lookup just confirmed as CUSTOMER is never reachable as allowed', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(true)
    mockGetSalesforceClient.mockReturnValue({ orgId: 'org-1' })
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-cust', email: 'cust@acme.com', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3) })])
    mockLookupByEmails.mockResolvedValue(
      new Map([['cust@acme.com', { status: 'CUSTOMER', detail: 'Acme', person: { id: '003X', type: 'CONTACT', accountId: 'acc-9' } }]]),
    )
    p.lead.update.mockRejectedValue(new Error('pool timeout'))

    await expect(ensureSalesforceClear('org-1', ['lead-cust'], NOW)).rejects.toThrow('pool timeout')
  })

  it('does not fall back to holdOrDecideFromStale on a write failure (would re-decide from stale rows)', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(true)
    mockGetSalesforceClient.mockReturnValue({ orgId: 'org-1' })
    // Stored status is stale-but-clear; if the catch wrongly re-ran the stale
    // fallback after a write failure, this lead would come back "allowed"
    // from the 7-day rule even though Salesforce just said CUSTOMER.
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-cust', email: 'cust@acme.com', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3) })])
    mockLookupByEmails.mockResolvedValue(new Map([['cust@acme.com', { status: 'CUSTOMER', detail: 'Acme', person: null }]]))
    p.lead.update.mockRejectedValue(new Error('pool timeout'))

    await expect(ensureSalesforceClear('org-1', ['lead-cust'], NOW)).rejects.toThrow('pool timeout')
    // holdOrDecideFromStale's bulk write (sfHeldSince stamping) must never have run.
    expect(p.lead.updateMany).not.toHaveBeenCalled()
  })
})

describe('ensureSalesforceClear - decision sets are mutually exclusive', () => {
  it('never places a lead id in more than one of allowed/held/blocked, across a mixed batch', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(true)
    mockGetSalesforceClient.mockReturnValue({ orgId: 'org-1' })
    p.lead.findMany.mockResolvedValue([
      leadRow({ id: 'lead-override', sfBlockOverride: true, sfCheckStatus: 'CUSTOMER', sfCheckedAt: hoursAgo(1) }),
      leadRow({ id: 'lead-fresh-blocked', sfCheckStatus: 'CUSTOMER', sfCheckDetail: 'Acme', sfCheckedAt: hoursAgo(1) }),
      leadRow({ id: 'lead-fresh-allowed', sfCheckStatus: 'CLEAR', sfCheckedAt: hoursAgo(1) }),
      leadRow({ id: 'lead-lookup-blocked', email: 'blocked@acme.com', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3) }),
      leadRow({ id: 'lead-lookup-allowed', email: 'clear@acme.com', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3) }),
      leadRow({ id: 'lead-lookup-missing-key', email: 'missing@acme.com', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3) }),
    ])
    mockLookupByEmails.mockResolvedValue(
      new Map([
        ['blocked@acme.com', { status: 'CUSTOMER', detail: 'Acme', person: null }],
        ['clear@acme.com', { status: 'CLEAR', detail: null, person: null }],
        // 'missing@acme.com' intentionally absent.
      ]),
    )

    const result = await ensureSalesforceClear(
      'org-1',
      [
        'lead-override',
        'lead-fresh-blocked',
        'lead-fresh-allowed',
        'lead-lookup-blocked',
        'lead-lookup-allowed',
        'lead-lookup-missing-key',
        'lead-missing-row',
      ],
      NOW,
    )

    const allIds = [...result.allowed, ...result.held, ...result.blocked.keys()]
    expect(new Set(allIds).size).toBe(allIds.length) // no id appears twice across the three sets

    expect(result.allowed.has('lead-override')).toBe(true)
    expect(result.blocked.has('lead-fresh-blocked')).toBe(true)
    expect(result.allowed.has('lead-fresh-allowed')).toBe(true)
    expect(result.blocked.has('lead-lookup-blocked')).toBe(true)
    expect(result.allowed.has('lead-lookup-allowed')).toBe(true)
    expect(result.held.has('lead-lookup-missing-key')).toBe(true)
    expect(result.held.has('lead-missing-row')).toBe(true)
  })
})

describe('ensureSalesforceClear - I2: the lookup failure is logged', () => {
  it('logs the lookup error once, naming the org', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockGetConnection.mockResolvedValue(baseConn())
      mockIsSalesforceActive.mockReturnValue(true)
      mockGetSalesforceClient.mockReturnValue({ orgId: 'org-1' })
      const boom = new Error('auth expired')
      mockLookupByEmails.mockRejectedValue(boom)
      p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-x', sfCheckedAt: daysAgo(3) })])

      await ensureSalesforceClear('org-1', ['lead-x'], NOW)

      expect(errSpy).toHaveBeenCalledWith('[salesforce-check] lookup failed for org org-1:', boom)
    } finally {
      errSpy.mockRestore()
    }
  })
})

describe('ensureSalesforceClear - M1: sfHeldSince is cleared once decided', () => {
  it('clears sfHeldSince in one batched updateMany for every lead decided allowed or blocked, but leaves a still-held lead alone', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(false)
    p.lead.findMany.mockResolvedValue([
      leadRow({ id: 'lead-override', sfBlockOverride: true, sfHeldSince: daysAgo(2) }),
      leadRow({ id: 'lead-fresh-blocked', sfCheckStatus: 'CUSTOMER', sfCheckDetail: 'Acme', sfCheckedAt: hoursAgo(1), sfHeldSince: daysAgo(2) }),
      leadRow({ id: 'lead-still-held', sfCheckedAt: null, sfHeldSince: daysAgo(2) }),
    ])

    const result = await ensureSalesforceClear('org-1', ['lead-override', 'lead-fresh-blocked', 'lead-still-held'], NOW)

    expect(result.allowed.has('lead-override')).toBe(true)
    expect(result.blocked.has('lead-fresh-blocked')).toBe(true)
    expect(result.held.has('lead-still-held')).toBe(true)
    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['lead-override', 'lead-fresh-blocked'] }, sfHeldSince: { not: null } },
      data: { sfHeldSince: null },
    })
  })
})

describe('ensureSalesforceClear - M2: held-alert failure handling', () => {
  it('does not stamp heldAlertedAt when sendOrgAlert returns false', async () => {
    mockGetConnection.mockResolvedValue(baseConn({ heldAlertedAt: null }))
    mockIsSalesforceActive.mockReturnValue(false)
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-never', sfCheckedAt: null })])
    p.lead.count.mockResolvedValue(1)
    mockSendOrgAlert.mockResolvedValue(false)

    await ensureSalesforceClear('org-1', ['lead-never'], NOW)

    expect(mockSendOrgAlert).toHaveBeenCalled()
    expect(p.salesforceConnection.update).not.toHaveBeenCalled()
  })

  it('never rejects when the held-alert bookkeeping write fails, and logs it', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockGetConnection.mockResolvedValue(baseConn({ heldAlertedAt: null }))
      mockIsSalesforceActive.mockReturnValue(false)
      p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-never', sfCheckedAt: null })])
      p.lead.count.mockResolvedValue(1)
      p.salesforceConnection.update.mockRejectedValue(new Error('row gone (disconnected concurrently)'))

      const result = await ensureSalesforceClear('org-1', ['lead-never'], NOW)

      expect(result.held.has('lead-never')).toBe(true)
      expect(errSpy).toHaveBeenCalledWith('[salesforce-check] held alert failed for org org-1:', expect.any(Error))
    } finally {
      errSpy.mockRestore()
    }
  })
})

describe('ensureSalesforceClear - missing leads', () => {
  it('holds a requested leadId that findMany does not return (wrong org or deleted), never allowing it', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-real', sfCheckStatus: 'CLEAR', sfCheckedAt: hoursAgo(1) })])

    const result = await ensureSalesforceClear('org-1', ['lead-real', 'lead-ghost'], NOW)

    expect(result.allowed.has('lead-real')).toBe(true)
    expect(result.held.has('lead-ghost')).toBe(true)
    expect(result.allowed.has('lead-ghost')).toBe(false)
    expect(result.blocked.has('lead-ghost')).toBe(false)
  })
})

describe('ensureSalesforceClear - M3(a): lookup returns a blocking status', () => {
  it('blocks a lead the lookup finds OPTED_OUT, with the classified reason', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(true)
    mockGetSalesforceClient.mockReturnValue({ orgId: 'org-1' })
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-opt-out', email: 'optout@acme.com', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3) })])
    mockLookupByEmails.mockResolvedValue(new Map([['optout@acme.com', { status: 'OPTED_OUT', detail: null, person: null }]]))

    const result = await ensureSalesforceClear('org-1', ['lead-opt-out'], NOW)

    expect(result.blocked.get('lead-opt-out')).toBe('Salesforce: opted out')
    expect(result.allowed.has('lead-opt-out')).toBe(false)
  })
})

describe('ensureSalesforceClear - M3(b): lookup fails with a stored blocking status', () => {
  it('stays blocked when the stored status is blocking and under 7 days old', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(true)
    mockGetSalesforceClient.mockReturnValue({ orgId: 'org-1' })
    mockLookupByEmails.mockRejectedValue(new Error('network timeout'))
    p.lead.findMany.mockResolvedValue([
      leadRow({ id: 'lead-stale-customer', sfCheckStatus: 'CUSTOMER', sfCheckDetail: 'Acme', sfCheckedAt: daysAgo(3) }),
    ])

    const result = await ensureSalesforceClear('org-1', ['lead-stale-customer'], NOW)

    expect(result.blocked.get('lead-stale-customer')).toBe('Salesforce: customer (Acme)')
    expect(result.allowed.has('lead-stale-customer')).toBe(false)
  })
})

describe('ensureSalesforceClear - M3(c): stored NOT_FOUND', () => {
  it('allows a lead with a fresh (1h) stored NOT_FOUND, with no lookup', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-not-found', sfCheckStatus: 'NOT_FOUND', sfCheckedAt: hoursAgo(1) })])

    const result = await ensureSalesforceClear('org-1', ['lead-not-found'], NOW)

    expect(result.allowed.has('lead-not-found')).toBe(true)
    expect(mockLookupByEmails).not.toHaveBeenCalled()
  })
})

describe('ensureSalesforceClear - M3(d): lookup map missing a key', () => {
  it('holds a lead whose email the lookup result has no entry for, rather than allowing it', async () => {
    mockGetConnection.mockResolvedValue(baseConn())
    mockIsSalesforceActive.mockReturnValue(true)
    mockGetSalesforceClient.mockReturnValue({ orgId: 'org-1' })
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-x', email: 'x@acme.com', sfCheckedAt: daysAgo(3) })])
    mockLookupByEmails.mockResolvedValue(new Map())

    const result = await ensureSalesforceClear('org-1', ['lead-x'], NOW)

    expect(result.held.has('lead-x')).toBe(true)
    expect(result.allowed.has('lead-x')).toBe(false)
  })
})

// sanity: constants used by callers elsewhere are exported with the documented values
describe('ensureSalesforceClear - per-org lookup failure memo (I2)', () => {
  const secondsLater = (s: number) => new Date(NOW.getTime() + s * 1000)

  beforeEach(() => {
    mockGetConnection.mockResolvedValue(baseConn())
    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-1', email: 'a@acme.com' })])
  })

  it('backs off for 60 seconds', () => {
    expect(SF_LOOKUP_BACKOFF_MS).toBe(60_000)
  })

  it('two calls within 60s after a failure look up once; the second holds without a lookup', async () => {
    mockLookupByEmails.mockRejectedValue(new Error('timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const first = await ensureSalesforceClear('org-1', ['lead-1'], NOW)
    const second = await ensureSalesforceClear('org-1', ['lead-1'], secondsLater(59))

    expect(mockLookupByEmails).toHaveBeenCalledTimes(1)
    expect(first.held.has('lead-1')).toBe(true)
    expect(second.held.has('lead-1')).toBe(true)
  })

  it('during the backoff a stale-but-recent stored check still decides', async () => {
    mockLookupByEmails.mockRejectedValue(new Error('timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await ensureSalesforceClear('org-1', ['lead-1'], NOW)

    p.lead.findMany.mockResolvedValue([leadRow({ id: 'lead-1', sfCheckStatus: 'CLEAR', sfCheckedAt: daysAgo(3) })])
    const result = await ensureSalesforceClear('org-1', ['lead-1'], secondsLater(30))

    expect(mockLookupByEmails).toHaveBeenCalledTimes(1)
    expect(result.allowed.has('lead-1')).toBe(true)
  })

  it('the memo is per org', async () => {
    mockLookupByEmails.mockRejectedValue(new Error('timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await ensureSalesforceClear('org-1', ['lead-1'], NOW)
    await ensureSalesforceClear('org-2', ['lead-1'], secondsLater(1))
    expect(mockLookupByEmails).toHaveBeenCalledTimes(2)
  })

  it('after 60s the lookup runs again', async () => {
    mockLookupByEmails.mockRejectedValue(new Error('timeout'))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await ensureSalesforceClear('org-1', ['lead-1'], NOW)
    await ensureSalesforceClear('org-1', ['lead-1'], secondsLater(60))

    expect(mockLookupByEmails).toHaveBeenCalledTimes(2)
  })

  it('a successful lookup clears the memo', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockLookupByEmails
      .mockRejectedValueOnce(new Error('timeout')) // t=0 fails, memo set
      .mockResolvedValueOnce(new Map([['a@acme.com', { status: 'CLEAR', detail: null, person: null }]])) // t=61 succeeds
      .mockRejectedValueOnce(new Error('timeout')) // t=62 fails again
      .mockRejectedValue(new Error('should not be called'))

    await ensureSalesforceClear('org-1', ['lead-1'], NOW)
    await ensureSalesforceClear('org-1', ['lead-1'], secondsLater(61))
    // Success cleared the memo, so a call right after runs a lookup again.
    await ensureSalesforceClear('org-1', ['lead-1'], secondsLater(62))
    expect(mockLookupByEmails).toHaveBeenCalledTimes(3)
    // ...and that failure sets the memo afresh.
    await ensureSalesforceClear('org-1', ['lead-1'], secondsLater(63))
    expect(mockLookupByEmails).toHaveBeenCalledTimes(3)
  })
})

describe('constants', () => {
  it('SF_FRESH_MS is 24 hours and SF_STALE_OK_MS is 7 days', () => {
    expect(SF_FRESH_MS).toBe(24 * 60 * 60 * 1000)
    expect(SF_STALE_OK_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
