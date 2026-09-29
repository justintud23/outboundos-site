import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/salesforce/server/require-connection', () => ({
  requireActiveConnection: vi.fn(),
  salesforceErrorResponse: vi.fn(),
}))
vi.mock('@/features/salesforce/server/import-list-view', () => ({ listListViews: vi.fn() }))

import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { requireActiveConnection, salesforceErrorResponse } from '@/features/salesforce/server/require-connection'
import { listListViews } from '@/features/salesforce/server/import-list-view'
import { SalesforceApiError, SalesforceAuthError, SalesforceRateLimitError } from '@/features/salesforce/server/errors'
import { GET } from './route'

const ctx = { org: { id: 'org-1' }, member: { id: 'm-1' }, isAdmin: false }

const call = (qs = '?object=Lead') => GET(new Request(`http://x/api/salesforce/list-views${qs}`))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(ctx as never)
  vi.mocked(requireActiveConnection).mockResolvedValue({ id: 'conn-1' } as never)
  vi.mocked(listListViews).mockResolvedValue([{ id: 'lv1', label: 'My List' }])
  vi.mocked(salesforceErrorResponse).mockReturnValue(null)
})

describe('GET /api/salesforce/list-views', () => {
  it('401 without a member', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Unauthorized' })
    expect(listListViews).not.toHaveBeenCalled()
  })

  it('400 when object is missing or not Lead/Contact', async () => {
    const res = await call('?object=Deal')
    expect(res.status).toBe(400)
    expect(listListViews).not.toHaveBeenCalled()
  })

  it('409 when not connected', async () => {
    vi.mocked(requireActiveConnection).mockResolvedValue(
      NextResponse.json({ code: 'NOT_CONNECTED', error: 'Connect Salesforce in Settings first.' }, { status: 409 }),
    )
    const res = await call()
    expect(res.status).toBe(409)
    expect(listListViews).not.toHaveBeenCalled()
  })

  it('returns list views for a connected org', async () => {
    const res = await call('?object=Contact')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ listViews: [{ id: 'lv1', label: 'My List' }] })
    expect(listListViews).toHaveBeenCalledWith('org-1', 'Contact')
  })

  it.each([
    ['SalesforceAuthError', new SalesforceAuthError(), 409],
    ['SalesforceRateLimitError', new SalesforceRateLimitError(), 429],
    ['SalesforceApiError', new SalesforceApiError(500, 'SERVER_ERROR', 'boom'), 502],
  ])('maps %s from listListViews', async (_label, err, status) => {
    vi.mocked(listListViews).mockRejectedValue(err)
    vi.mocked(salesforceErrorResponse).mockReturnValue(NextResponse.json({ error: 'mapped' }, { status }))
    const res = await call()
    expect(res.status).toBe(status)
  })
})
