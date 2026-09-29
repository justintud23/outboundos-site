import { NextResponse } from 'next/server'
import type { SalesforceConnection } from '@prisma/client'
import { getConnection, isSalesforceActive } from './connection'
import { SalesforceApiError, SalesforceAuthError, SalesforceRateLimitError } from './errors'

// Shared guard for every Salesforce route (list views, preview, import): no
// connection, a connection that needs reconnecting, or one that's still
// rate-limited today all fail the same way regardless of which route asked.
export async function requireActiveConnection(organizationId: string): Promise<SalesforceConnection | NextResponse> {
  const conn = await getConnection(organizationId)
  if (!conn) {
    return NextResponse.json({ code: 'NOT_CONNECTED', error: 'Connect Salesforce in Settings first.' }, { status: 409 })
  }
  if (conn.status === 'NEEDS_RECONNECT') {
    return NextResponse.json({ code: 'NOT_CONNECTED', error: 'Reconnect Salesforce in Settings.' }, { status: 409 })
  }
  // Salesforce work pauses org-wide while rate-limited (spec §5): importing
  // here would burn the remaining daily quota that sending needs. A row
  // whose rateLimitedUntil has already passed (the nightly release job just
  // hasn't run yet) is still treated as active.
  if (conn.status === 'RATE_LIMITED' && !isSalesforceActive(conn)) {
    return NextResponse.json({ code: 'RATE_LIMITED', error: 'Salesforce API limit reached for today.' }, { status: 429 })
  }
  return conn
}

/**
 * Maps a Salesforce client error to the response every list-view/preview/
 * import route shares. Returns null for anything else — the caller logs it
 * and returns its own 500.
 */
export function salesforceErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof SalesforceAuthError) {
    return NextResponse.json({ code: 'NOT_CONNECTED', error: 'Reconnect Salesforce in Settings.' }, { status: 409 })
  }
  if (err instanceof SalesforceRateLimitError) {
    return NextResponse.json({ code: 'RATE_LIMITED', error: 'Salesforce API limit reached for today.' }, { status: 429 })
  }
  if (err instanceof SalesforceApiError) {
    return NextResponse.json({ code: 'SALESFORCE_ERROR', error: err.message }, { status: 502 })
  }
  return null
}
