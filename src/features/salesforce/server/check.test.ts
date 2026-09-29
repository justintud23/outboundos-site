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
import { ensureSalesforceClear, applySalesforceBlock, prefetchSalesforceChecks, SF_FRESH_MS, SF_STALE_OK_MS } from './check'

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
      sfHeldSince: null,
      salesforceId: '003A',
      salesforceType: 'CONTACT',
      salesforceAccountId: 'acc-1',
    })

    const updateB = p.lead.update.mock.calls.find((c: unknown[]) => (c[0] as { where: { id: string } }).where.id === 'lead-b')
    expect(updateB?.[0].data).toMatchObject({ sfCheckStatus: 'CLEAR', sfCheckedAt: NOW, sfHeldSince: null })
    expect(updateB?.[0].data).not.toHaveProperty('salesforceId')

    expect(result.allowed).toEqual(new Set(['lead-a', 'lead-b']))
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
      where: { organizationId: 'org-1', leadId: 'lead-1', status: { in: ['PENDING_REVIEW', 'APPROVED'] }, outboundMessages: { none: {} } },
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
})

// sanity: constants used by callers elsewhere are exported with the documented values
describe('constants', () => {
  it('SF_FRESH_MS is 24 hours and SF_STALE_OK_MS is 7 days', () => {
    expect(SF_FRESH_MS).toBe(24 * 60 * 60 * 1000)
    expect(SF_STALE_OK_MS).toBe(7 * 24 * 60 * 60 * 1000)
  })
})
