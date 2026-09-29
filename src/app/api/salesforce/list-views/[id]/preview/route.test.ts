import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/salesforce/server/require-connection', () => ({
  requireActiveConnection: vi.fn(),
  salesforceErrorResponse: vi.fn(),
}))
vi.mock('@/features/salesforce/server/import-list-view', () => ({ previewListView: vi.fn() }))

import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { requireActiveConnection, salesforceErrorResponse } from '@/features/salesforce/server/require-connection'
import { previewListView } from '@/features/salesforce/server/import-list-view'
import { SalesforceApiError, SalesforceAuthError, SalesforceRateLimitError } from '@/features/salesforce/server/errors'
import { GET } from './route'

const ctx = { org: { id: 'org-1' }, member: { id: 'm-1' }, isAdmin: false }
const previewResult = { total: 1, rows: [{ id: 'sf-1', name: 'Ann Lee', email: 'ann@acme.com', company: 'Acme', title: 'VP' }] }

const call = (qs = '?object=Lead', id = 'lv-1') =>
  GET(new Request(`http://x/api/salesforce/list-views/${id}/preview${qs}`), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(ctx as never)
  vi.mocked(requireActiveConnection).mockResolvedValue({ id: 'conn-1' } as never)
  vi.mocked(previewListView).mockResolvedValue(previewResult)
  vi.mocked(salesforceErrorResponse).mockReturnValue(null)
})

describe('GET /api/salesforce/list-views/[id]/preview', () => {
  it('401 without a member', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
    expect(previewListView).not.toHaveBeenCalled()
  })

  it('400 when object is missing or not Lead/Contact', async () => {
    const res = await call('?object=Deal')
    expect(res.status).toBe(400)
    expect(previewListView).not.toHaveBeenCalled()
  })

  it('409 when not connected', async () => {
    vi.mocked(requireActiveConnection).mockResolvedValue(
      NextResponse.json({ code: 'NOT_CONNECTED', error: 'Connect Salesforce in Settings first.' }, { status: 409 }),
    )
    const res = await call()
    expect(res.status).toBe(409)
    expect(previewListView).not.toHaveBeenCalled()
  })

  it('returns the preview for the given list view id and object', async () => {
    const res = await call('?object=Lead', 'lv-42')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(previewResult)
    expect(previewListView).toHaveBeenCalledWith({ organizationId: 'org-1', object: 'Lead', listViewId: 'lv-42' })
  })

  it.each([
    ['SalesforceAuthError', new SalesforceAuthError(), 409],
    ['SalesforceRateLimitError', new SalesforceRateLimitError(), 429],
    ['SalesforceApiError', new SalesforceApiError(500, 'SERVER_ERROR', 'boom'), 502],
  ])('maps %s from previewListView', async (_label, err, status) => {
    vi.mocked(previewListView).mockRejectedValue(err)
    vi.mocked(salesforceErrorResponse).mockReturnValue(NextResponse.json({ error: 'mapped' }, { status }))
    const res = await call()
    expect(res.status).toBe(status)
  })
})
