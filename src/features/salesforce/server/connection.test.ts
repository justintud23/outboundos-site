import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    salesforceConnection: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn(), updateMany: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
    lead: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('./oauth', () => ({ refreshAccessToken: vi.fn() }))
vi.mock('@/features/replies/server/notify', () => ({ sendOrgAlert: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { refreshAccessToken } from './oauth'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { decryptToken } from '@/lib/crypto/token-cipher'
import { SalesforceAuthError } from './errors'
import {
  getConnection,
  saveConnection,
  deleteConnection,
  getAccessToken,
  invalidateAccessToken,
  markNeedsReconnect,
  markRateLimited,
  releaseExpiredRateLimits,
  isSalesforceActive,
} from './connection'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  salesforceConnection: { findUnique: Fn; upsert: Fn; deleteMany: Fn; updateMany: Fn }
  organization: { findUnique: Fn; update: Fn }
  lead: { updateMany: Fn }
  $transaction: Fn
}
const mockRefreshAccessToken = refreshAccessToken as unknown as Fn
const mockSendOrgAlert = sendOrgAlert as unknown as Fn

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TOKEN_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'))
  // The access-token cache is module-scoped (persists across tests in this file); clear it explicitly.
  invalidateAccessToken('org-1')
  p.$transaction.mockImplementation((fn: (tx: typeof p) => unknown) => fn(p))
  p.organization.findUnique.mockResolvedValue({ lastSalesforceOrgId: null })
  p.organization.update.mockResolvedValue({})
  p.salesforceConnection.upsert.mockResolvedValue({})
  p.lead.updateMany.mockResolvedValue({ count: 0 })
  p.salesforceConnection.updateMany.mockResolvedValue({ count: 1 })
  p.salesforceConnection.deleteMany.mockResolvedValue({ count: 1 })
  mockSendOrgAlert.mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

const baseInput = {
  instanceUrl: 'https://my.salesforce.com',
  loginHost: 'https://login.salesforce.com',
  sfOrgId: '00Dxx0000000001',
  sfUserId: '005xx000000001',
  sfUsername: 'admin@example.com',
  sfUserEmail: 'admin@example.com',
  refreshToken: 'the-plaintext-refresh-token',
}

describe('saveConnection', () => {
  it('encrypts the refresh token before storing it', async () => {
    await saveConnection('org-1', 'mem-1', baseInput)
    const call = p.salesforceConnection.upsert.mock.calls[0][0]
    expect(call.create.refreshTokenEnc).not.toBe(baseInput.refreshToken)
    expect(decryptToken(call.create.refreshTokenEnc)).toBe(baseInput.refreshToken)
    expect(call.update.refreshTokenEnc).toBe(call.create.refreshTokenEnc)
  })

  it('upserts with status CONNECTED, lastError null, rateLimitedUntil null, and sets lastSalesforceOrgId', async () => {
    await saveConnection('org-1', 'mem-1', baseInput)
    const call = p.salesforceConnection.upsert.mock.calls[0][0]
    expect(call.where).toEqual({ organizationId: 'org-1' })
    expect(call.create).toMatchObject({
      organizationId: 'org-1',
      status: 'CONNECTED',
      lastError: null,
      rateLimitedUntil: null,
      connectedByMemberId: 'mem-1',
    })
    expect(p.organization.update).toHaveBeenCalledWith({
      where: { id: 'org-1' },
      data: { lastSalesforceOrgId: baseInput.sfOrgId },
    })
  })

  it('returns orgChanged: true and clears lead Salesforce links when lastSalesforceOrgId differs', async () => {
    p.organization.findUnique.mockResolvedValue({ lastSalesforceOrgId: 'a-different-org' })
    const result = await saveConnection('org-1', 'mem-1', baseInput)
    expect(result).toEqual({ orgChanged: true })
    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      data: {
        salesforceId: null,
        salesforceType: null,
        salesforceAccountId: null,
        sfCheckStatus: null,
        sfCheckedAt: null,
        sfCheckDetail: null,
        sfBlockOverride: false,
        sfHeldSince: null,
      },
    })
  })

  it('returns orgChanged: false when lastSalesforceOrgId is null', async () => {
    p.organization.findUnique.mockResolvedValue({ lastSalesforceOrgId: null })
    const result = await saveConnection('org-1', 'mem-1', baseInput)
    expect(result).toEqual({ orgChanged: false })
    expect(p.lead.updateMany).not.toHaveBeenCalled()
  })

  it('returns orgChanged: false when lastSalesforceOrgId is the same', async () => {
    p.organization.findUnique.mockResolvedValue({ lastSalesforceOrgId: baseInput.sfOrgId })
    const result = await saveConnection('org-1', 'mem-1', baseInput)
    expect(result).toEqual({ orgChanged: false })
    expect(p.lead.updateMany).not.toHaveBeenCalled()
  })
})

describe('getAccessToken', () => {
  const conn = {
    organizationId: 'org-1',
    loginHost: 'https://login.salesforce.com',
    refreshTokenEnc: '',
    instanceUrl: 'https://my.salesforce.com',
  }

  beforeEach(() => {
    conn.refreshTokenEnc = ''
  })

  it('calls refreshAccessToken once, then serves the cached token on the second call when the row is unchanged', async () => {
    // Encrypt a real refresh token so decryptToken succeeds inside getAccessToken.
    const { encryptToken } = await import('@/lib/crypto/token-cipher')
    p.salesforceConnection.findUnique.mockResolvedValue({ ...conn, refreshTokenEnc: encryptToken('rt-1') })
    mockRefreshAccessToken.mockResolvedValue({ accessToken: 'at-1', instanceUrl: 'https://my.salesforce.com' })

    const first = await getAccessToken('org-1')
    const second = await getAccessToken('org-1')

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1)
    // Row is read on every call (cheap, unique-indexed) so a multi-instance
    // deploy notices a reconnect/disconnect within one call, not up to 50 min.
    expect(p.salesforceConnection.findUnique).toHaveBeenCalledTimes(2)
    expect(second).toEqual(first)
  })

  it('the returned object has no `at` field (only accessToken and instanceUrl)', async () => {
    const { encryptToken } = await import('@/lib/crypto/token-cipher')
    p.salesforceConnection.findUnique.mockResolvedValue({ ...conn, refreshTokenEnc: encryptToken('rt-1') })
    mockRefreshAccessToken.mockResolvedValue({ accessToken: 'at-1', instanceUrl: 'https://my.salesforce.com' })

    const result = await getAccessToken('org-1')

    expect(result).toEqual({ accessToken: 'at-1', instanceUrl: 'https://my.salesforce.com' })
    expect(Object.keys(result).sort()).toEqual(['accessToken', 'instanceUrl'])
  })

  it('refreshes again when the row refreshTokenEnc changed (a reconnect happened elsewhere)', async () => {
    const { encryptToken } = await import('@/lib/crypto/token-cipher')
    p.salesforceConnection.findUnique.mockResolvedValueOnce({ ...conn, refreshTokenEnc: encryptToken('rt-1') })
    mockRefreshAccessToken.mockResolvedValueOnce({ accessToken: 'at-1', instanceUrl: 'https://my.salesforce.com' })
    await getAccessToken('org-1')

    // A reconnect (possibly on a different instance) replaced the stored refresh token.
    p.salesforceConnection.findUnique.mockResolvedValueOnce({ ...conn, refreshTokenEnc: encryptToken('rt-2') })
    mockRefreshAccessToken.mockResolvedValueOnce({ accessToken: 'at-2', instanceUrl: 'https://my.salesforce.com' })
    const second = await getAccessToken('org-1')

    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(2)
    expect(second).toEqual({ accessToken: 'at-2', instanceUrl: 'https://my.salesforce.com' })
  })

  it('throws SalesforceAuthError when the row is gone (a disconnect happened elsewhere), without calling refreshAccessToken', async () => {
    p.salesforceConnection.findUnique.mockResolvedValue(null)

    await expect(getAccessToken('org-1')).rejects.toThrow(SalesforceAuthError)
    expect(mockRefreshAccessToken).not.toHaveBeenCalled()
  })

  it('calls markNeedsReconnect and rethrows on a SalesforceAuthError', async () => {
    const { encryptToken } = await import('@/lib/crypto/token-cipher')
    p.salesforceConnection.findUnique.mockResolvedValue({ ...conn, refreshTokenEnc: encryptToken('rt-1') })
    mockRefreshAccessToken.mockRejectedValue(new SalesforceAuthError('invalid_grant'))

    await expect(getAccessToken('org-1')).rejects.toThrow(SalesforceAuthError)
    expect(p.salesforceConnection.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', status: { not: 'NEEDS_RECONNECT' } },
      data: { status: 'NEEDS_RECONNECT', lastError: 'invalid_grant' },
    })
  })
})

describe('markNeedsReconnect', () => {
  it('uses updateMany scoped to status not NEEDS_RECONNECT, and alerts only when count === 1', async () => {
    p.salesforceConnection.updateMany.mockResolvedValue({ count: 1 })
    await markNeedsReconnect('org-1', 'token expired')
    expect(p.salesforceConnection.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', status: { not: 'NEEDS_RECONNECT' } },
      data: { status: 'NEEDS_RECONNECT', lastError: 'token expired' },
    })
    expect(mockSendOrgAlert).toHaveBeenCalledWith(
      'org-1',
      'Salesforce disconnected',
      expect.stringContaining('reconnect in Settings'),
    )
  })

  it('does not alert when count is 0 (already NEEDS_RECONNECT)', async () => {
    p.salesforceConnection.updateMany.mockResolvedValue({ count: 0 })
    await markNeedsReconnect('org-1', 'token expired')
    expect(mockSendOrgAlert).not.toHaveBeenCalled()
  })
})

describe('markRateLimited', () => {
  it('alerts only on the transition from CONNECTED (count === 1)', async () => {
    p.salesforceConnection.updateMany.mockResolvedValue({ count: 1 })
    const until = new Date('2026-10-01T00:00:00Z')
    await markRateLimited('org-1', until)
    expect(p.salesforceConnection.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', status: 'CONNECTED' },
      data: { status: 'RATE_LIMITED', rateLimitedUntil: until },
    })
    expect(mockSendOrgAlert).toHaveBeenCalledWith(
      'org-1',
      'Salesforce API limit reached',
      expect.any(String),
    )
  })

  it('does not alert when count is 0', async () => {
    p.salesforceConnection.updateMany.mockResolvedValue({ count: 0 })
    await markRateLimited('org-1', new Date())
    expect(mockSendOrgAlert).not.toHaveBeenCalled()
  })
})

describe('isSalesforceActive', () => {
  it('CONNECTED -> true', () => {
    expect(isSalesforceActive({ status: 'CONNECTED', rateLimitedUntil: null })).toBe(true)
  })
  it('NEEDS_RECONNECT -> false', () => {
    expect(isSalesforceActive({ status: 'NEEDS_RECONNECT', rateLimitedUntil: null })).toBe(false)
  })
  it('RATE_LIMITED with rateLimitedUntil in the future -> false', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const future = new Date('2026-01-01T01:00:00Z')
    expect(isSalesforceActive({ status: 'RATE_LIMITED', rateLimitedUntil: future }, now)).toBe(false)
  })
  it('RATE_LIMITED with rateLimitedUntil in the past -> true', () => {
    const now = new Date('2026-01-01T01:00:00Z')
    const past = new Date('2026-01-01T00:00:00Z')
    expect(isSalesforceActive({ status: 'RATE_LIMITED', rateLimitedUntil: past }, now)).toBe(true)
  })
})

describe('releaseExpiredRateLimits', () => {
  it('updates RATE_LIMITED rows with rateLimitedUntil <= now to CONNECTED', async () => {
    const now = new Date('2026-01-01T00:00:00Z')
    await releaseExpiredRateLimits(now)
    expect(p.salesforceConnection.updateMany).toHaveBeenCalledWith({
      where: { status: 'RATE_LIMITED', rateLimitedUntil: { lte: now } },
      data: { status: 'CONNECTED', rateLimitedUntil: null },
    })
  })
})

describe('getConnection / deleteConnection', () => {
  it('getConnection reads by organizationId', async () => {
    p.salesforceConnection.findUnique.mockResolvedValue({ id: 'conn-1' })
    const result = await getConnection('org-1')
    expect(p.salesforceConnection.findUnique).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } })
    expect(result).toEqual({ id: 'conn-1' })
  })

  it('deleteConnection deletes by organizationId', async () => {
    await deleteConnection('org-1')
    expect(p.salesforceConnection.deleteMany).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } })
  })
})
