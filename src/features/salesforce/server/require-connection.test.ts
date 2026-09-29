import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./connection', () => ({ getConnection: vi.fn(), isSalesforceActive: vi.fn() }))

import { getConnection, isSalesforceActive } from './connection'
import { requireActiveConnection, salesforceErrorResponse } from './require-connection'
import { SalesforceApiError, SalesforceAuthError, SalesforceRateLimitError } from './errors'

const mockGetConnection = vi.mocked(getConnection)
const mockIsSalesforceActive = vi.mocked(isSalesforceActive)

// A NextResponse and a raw SalesforceConnection row both happen to have a
// `status` field (HTTP code vs. connection status string) — this is how the
// tests tell them apart without relying on `instanceof` across module copies.
function isJsonResponse(v: unknown): v is Response {
  return typeof v === 'object' && v !== null && typeof (v as Response).json === 'function' && typeof (v as Response).status === 'number'
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('requireActiveConnection', () => {
  it('409 NOT_CONNECTED when there is no connection row', async () => {
    mockGetConnection.mockResolvedValue(null)
    const res = await requireActiveConnection('org-1')
    expect(isJsonResponse(res)).toBe(true)
    const r = res as Response
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ code: 'NOT_CONNECTED', error: 'Connect Salesforce in Settings first.' })
  })

  it('409 NOT_CONNECTED when the status is NEEDS_RECONNECT', async () => {
    mockGetConnection.mockResolvedValue({ status: 'NEEDS_RECONNECT', rateLimitedUntil: null } as never)
    const res = await requireActiveConnection('org-1')
    const r = res as Response
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ code: 'NOT_CONNECTED', error: 'Reconnect Salesforce in Settings.' })
  })

  it('429 RATE_LIMITED when the status is RATE_LIMITED and unexpired', async () => {
    const future = new Date(Date.now() + 60_000)
    mockGetConnection.mockResolvedValue({ status: 'RATE_LIMITED', rateLimitedUntil: future } as never)
    mockIsSalesforceActive.mockReturnValue(false)
    const res = await requireActiveConnection('org-1')
    const r = res as Response
    expect(r.status).toBe(429)
    expect(await r.json()).toEqual({ code: 'RATE_LIMITED', error: 'Salesforce API limit reached for today.' })
  })

  it('returns the connection row when CONNECTED', async () => {
    const conn = { status: 'CONNECTED', rateLimitedUntil: null }
    mockGetConnection.mockResolvedValue(conn as never)
    mockIsSalesforceActive.mockReturnValue(true)
    const res = await requireActiveConnection('org-1')
    expect(res).toBe(conn)
  })

  it('returns the connection row when RATE_LIMITED but already expired', async () => {
    const past = new Date(Date.now() - 60_000)
    const conn = { status: 'RATE_LIMITED', rateLimitedUntil: past }
    mockGetConnection.mockResolvedValue(conn as never)
    mockIsSalesforceActive.mockReturnValue(true)
    const res = await requireActiveConnection('org-1')
    expect(res).toBe(conn)
  })
})

describe('salesforceErrorResponse', () => {
  it('maps SalesforceAuthError to 409 NOT_CONNECTED', async () => {
    const res = salesforceErrorResponse(new SalesforceAuthError())
    expect(res?.status).toBe(409)
    expect(await res?.json()).toEqual({ code: 'NOT_CONNECTED', error: 'Reconnect Salesforce in Settings.' })
  })

  it('maps SalesforceRateLimitError to 429 RATE_LIMITED', async () => {
    const res = salesforceErrorResponse(new SalesforceRateLimitError())
    expect(res?.status).toBe(429)
    expect(await res?.json()).toEqual({ code: 'RATE_LIMITED', error: 'Salesforce API limit reached for today.' })
  })

  it('maps SalesforceApiError to 502 SALESFORCE_ERROR', async () => {
    const res = salesforceErrorResponse(new SalesforceApiError(500, 'SERVER_ERROR', 'Salesforce blew up'))
    expect(res?.status).toBe(502)
    expect(await res?.json()).toEqual({ code: 'SALESFORCE_ERROR', error: 'Salesforce blew up' })
  })

  it('returns null for anything else', () => {
    expect(salesforceErrorResponse(new Error('boom'))).toBeNull()
    expect(salesforceErrorResponse('not an error')).toBeNull()
  })
})
