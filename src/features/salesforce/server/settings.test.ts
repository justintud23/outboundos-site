import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    salesforceSyncJob: { count: vi.fn(), findMany: vi.fn() },
    salesforceConnection: { updateMany: vi.fn() },
    lead: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('./connection', () => ({ getConnection: vi.fn() }))
vi.mock('../config', () => ({ getSalesforceAppConfig: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { getConnection } from './connection'
import { getSalesforceAppConfig } from '../config'
import { getSalesforceStatus, updateSalesforceSettings } from './settings'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  salesforceSyncJob: { count: Fn; findMany: Fn }
  salesforceConnection: { updateMany: Fn }
  lead: { updateMany: Fn }
  $transaction: Fn
}
const mockGetConnection = getConnection as unknown as Fn
const mockGetAppConfig = getSalesforceAppConfig as unknown as Fn

const baseConn = {
  sfUsername: 'admin@example.com',
  instanceUrl: 'https://my.salesforce.com',
  loginHost: 'https://login.salesforce.com',
  status: 'CONNECTED' as const,
  lastError: null,
  rateLimitedUntil: null,
  customerAccountTypes: ['Customer', 'Key Account'],
  blockOpenOpportunities: true,
  logActivity: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAppConfig.mockReturnValue({ clientId: 'id', clientSecret: 'secret' })
  p.salesforceSyncJob.count.mockResolvedValue(0)
  p.salesforceSyncJob.findMany.mockResolvedValue([])
  p.salesforceConnection.updateMany.mockResolvedValue({ count: 1 })
  p.lead.updateMany.mockResolvedValue({ count: 3 })
  p.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(prisma))
})

describe('getSalesforceStatus', () => {
  it('reports configured: false when Salesforce app config is missing', async () => {
    mockGetAppConfig.mockReturnValue(null)
    mockGetConnection.mockResolvedValue(null)

    const status = await getSalesforceStatus('org-1')

    expect(status.configured).toBe(false)
  })

  it('returns not-connected defaults when there is no connection row', async () => {
    mockGetConnection.mockResolvedValue(null)

    const status = await getSalesforceStatus('org-1')

    expect(status.connected).toBe(false)
    expect(status.status).toBeNull()
    expect(status.username).toBeNull()
    expect(status.customerAccountTypes).toEqual(['Customer'])
    expect(status.blockOpenOpportunities).toBe(true)
    expect(status.logActivity).toBe(true)
    expect(status.counts).toEqual({ synced24h: 0, pending: 0, failed: 0 })
    expect(status.recentFailures).toEqual([])
    // No connection means we never hit the sync job table.
    expect(p.salesforceSyncJob.count).not.toHaveBeenCalled()
    expect(p.salesforceSyncJob.findMany).not.toHaveBeenCalled()
  })

  it('queries synced24h as DONE jobs updated within the last 24h, pending as PENDING, and failed as FAILED', async () => {
    mockGetConnection.mockResolvedValue(baseConn)
    p.salesforceSyncJob.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2).mockResolvedValueOnce(1)

    const status = await getSalesforceStatus('org-1')

    expect(status.counts).toEqual({ synced24h: 5, pending: 2, failed: 1 })

    const doneCall = p.salesforceSyncJob.count.mock.calls[0][0]
    expect(doneCall.where.organizationId).toBe('org-1')
    expect(doneCall.where.status).toBe('DONE')
    expect(doneCall.where.updatedAt.gte).toBeInstanceOf(Date)

    const pendingCall = p.salesforceSyncJob.count.mock.calls[1][0]
    expect(pendingCall.where).toEqual({ organizationId: 'org-1', status: 'PENDING' })

    const failedCall = p.salesforceSyncJob.count.mock.calls[2][0]
    expect(failedCall.where).toEqual({ organizationId: 'org-1', status: 'FAILED' })
  })

  it('returns the last 10 FAILED jobs ordered by updatedAt desc with the lead email', async () => {
    mockGetConnection.mockResolvedValue(baseConn)
    const updatedAt = new Date('2026-09-28T12:00:00.000Z')
    p.salesforceSyncJob.findMany.mockResolvedValue([
      { id: 'job-1', type: 'LOG_SEND', lastError: 'boom', updatedAt, lead: { email: 'a@b.com' } },
    ])

    const status = await getSalesforceStatus('org-1', { includeDetails: true })

    const call = p.salesforceSyncJob.findMany.mock.calls[0][0]
    expect(call.where).toEqual({ organizationId: 'org-1', status: 'FAILED' })
    expect(call.orderBy).toEqual({ updatedAt: 'desc' })
    expect(call.take).toBe(10)

    expect(status.recentFailures).toEqual([
      { id: 'job-1', type: 'LOG_SEND', leadEmail: 'a@b.com', lastError: 'boom', updatedAt: updatedAt.toISOString() },
    ])
  })

  it('maps connection fields onto the DTO when connected', async () => {
    mockGetConnection.mockResolvedValue(baseConn)

    const status = await getSalesforceStatus('org-1')

    expect(status.connected).toBe(true)
    expect(status.status).toBe('CONNECTED')
    expect(status.username).toBe('admin@example.com')
    expect(status.instanceUrl).toBe('https://my.salesforce.com')
    expect(status.loginHost).toBe('https://login.salesforce.com')
    expect(status.customerAccountTypes).toEqual(['Customer', 'Key Account'])
  })

  it('passes a sandbox loginHost through (I5)', async () => {
    mockGetConnection.mockResolvedValue({ ...baseConn, loginHost: 'https://test.salesforce.com' })
    const status = await getSalesforceStatus('org-1')
    expect(status.loginHost).toBe('https://test.salesforce.com')
  })

  it('serializes rateLimitedUntil to an ISO string when present', async () => {
    const rateLimitedUntil = new Date('2026-09-30T00:00:00.000Z')
    mockGetConnection.mockResolvedValue({ ...baseConn, status: 'RATE_LIMITED', rateLimitedUntil })

    const status = await getSalesforceStatus('org-1')

    expect(status.rateLimitedUntil).toBe(rateLimitedUntil.toISOString())
  })
})

describe('getSalesforceStatus - member payload (M2)', () => {
  it('without includeDetails, recentFailures is empty and lastError is null, and failed jobs are never read', async () => {
    mockGetConnection.mockResolvedValue({ ...baseConn, lastError: 'INVALID_SESSION_ID: expired' })
    p.salesforceSyncJob.findMany.mockResolvedValue([
      { id: 'job-1', type: 'LOG_SEND', lastError: 'boom', updatedAt: new Date(), lead: { email: 'a@b.com' } },
    ])

    const status = await getSalesforceStatus('org-1', { includeDetails: false })

    expect(status.recentFailures).toEqual([])
    expect(status.lastError).toBeNull()
    expect(p.salesforceSyncJob.findMany).not.toHaveBeenCalled()
  })

  it('defaults to hiding details when no option is given', async () => {
    mockGetConnection.mockResolvedValue({ ...baseConn, lastError: 'boom' })
    const status = await getSalesforceStatus('org-1')
    expect(status.lastError).toBeNull()
    expect(status.recentFailures).toEqual([])
  })

  it('with includeDetails, lastError and recentFailures are returned', async () => {
    mockGetConnection.mockResolvedValue({ ...baseConn, lastError: 'boom' })
    p.salesforceSyncJob.findMany.mockResolvedValue([
      { id: 'job-1', type: 'LOG_SEND', lastError: 'x', updatedAt: new Date('2026-09-28T00:00:00.000Z'), lead: { email: 'a@b.com' } },
    ])
    const status = await getSalesforceStatus('org-1', { includeDetails: true })
    expect(status.lastError).toBe('boom')
    expect(status.recentFailures).toHaveLength(1)
  })
})

describe('updateSalesforceSettings', () => {
  it('returns false when there is no connection row (updateMany matches nothing)', async () => {
    p.salesforceConnection.updateMany.mockResolvedValue({ count: 0 })

    const ok = await updateSalesforceSettings('org-1', { logActivity: false })

    expect(ok).toBe(false)
  })

  it('returns true and updates only the given keys', async () => {
    p.salesforceConnection.updateMany.mockResolvedValue({ count: 1 })

    const ok = await updateSalesforceSettings('org-1', { logActivity: false })

    expect(ok).toBe(true)
    const call = p.salesforceConnection.updateMany.mock.calls[0][0]
    expect(call.where).toEqual({ organizationId: 'org-1' })
    expect(call.data).toEqual({ logActivity: false })
  })

  it('passes through customerAccountTypes and blockOpenOpportunities together', async () => {
    await updateSalesforceSettings('org-1', {
      customerAccountTypes: ['Customer', 'Key Account'],
      blockOpenOpportunities: false,
    })

    const call = p.salesforceConnection.updateMany.mock.calls[0][0]
    expect(call.data).toEqual({ customerAccountTypes: ['Customer', 'Key Account'], blockOpenOpportunities: false })
  })
})

describe('updateSalesforceSettings - rule changes invalidate cached checks (I3)', () => {
  const invalidate = { where: { organizationId: 'org-1' }, data: { sfCheckedAt: null } }

  it('clears sfCheckedAt for the org when customerAccountTypes changes', async () => {
    await updateSalesforceSettings('org-1', { customerAccountTypes: ['Customer', 'Partner'] })
    expect(p.lead.updateMany).toHaveBeenCalledWith(invalidate)
  })

  it('clears sfCheckedAt for the org when blockOpenOpportunities changes', async () => {
    await updateSalesforceSettings('org-1', { blockOpenOpportunities: false })
    expect(p.lead.updateMany).toHaveBeenCalledWith(invalidate)
  })

  it('runs the settings update and the invalidation in one transaction', async () => {
    await updateSalesforceSettings('org-1', { blockOpenOpportunities: true })
    expect(p.$transaction).toHaveBeenCalledTimes(1)
    expect(p.salesforceConnection.updateMany).toHaveBeenCalledTimes(1)
  })

  it('does not touch leads for a logActivity-only patch', async () => {
    await updateSalesforceSettings('org-1', { logActivity: false })
    expect(p.lead.updateMany).not.toHaveBeenCalled()
  })

  it('does not touch leads when there is no connection row', async () => {
    p.salesforceConnection.updateMany.mockResolvedValue({ count: 0 })
    const ok = await updateSalesforceSettings('org-1', { customerAccountTypes: ['Customer'] })
    expect(ok).toBe(false)
    expect(p.lead.updateMany).not.toHaveBeenCalled()
  })
})
