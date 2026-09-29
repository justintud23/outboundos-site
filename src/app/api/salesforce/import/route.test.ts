import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/salesforce/server/require-connection', () => ({
  requireActiveConnection: vi.fn(),
  salesforceErrorResponse: vi.fn(),
}))
vi.mock('@/features/salesforce/server/import-list-view', () => ({ importListView: vi.fn() }))
vi.mock('@/features/leads/server/score-leads', () => ({ scoreLeads: vi.fn() }))

import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { requireActiveConnection, salesforceErrorResponse } from '@/features/salesforce/server/require-connection'
import { importListView } from '@/features/salesforce/server/import-list-view'
import { scoreLeads } from '@/features/leads/server/score-leads'
import { SalesforceApiError, SalesforceAuthError, SalesforceRateLimitError } from '@/features/salesforce/server/errors'
import { POST } from './route'

const member = { org: { id: 'org-1' }, member: { id: 'm-1' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin' }, isAdmin: true }

const body = { object: 'Lead', listViewId: 'lv1', listViewLabel: 'My NY Leads' }
const call = (b: unknown = body) => POST(new Request('http://x/api/salesforce/import', { method: 'POST', body: JSON.stringify(b) }))

const importResult = {
  batchId: 'batch-1',
  imported: 2,
  linked: 0,
  skipped: { customer: 0, openOpportunity: 0, optedOut: 0, converted: 0, noEmail: 0, invalid: 0 },
  leadIds: ['lead-1', 'lead-2'],
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(member as never)
  vi.mocked(requireActiveConnection).mockResolvedValue({ id: 'conn-1' } as never)
  vi.mocked(importListView).mockResolvedValue(importResult)
  vi.mocked(scoreLeads).mockResolvedValue([
    { leadId: 'lead-1', score: 80, reason: 'x' },
    { leadId: 'lead-2', score: 70, reason: 'y' },
  ] as never)
  vi.mocked(salesforceErrorResponse).mockReturnValue(null)
})

describe('POST /api/salesforce/import', () => {
  it('401 without a member', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
    expect(importListView).not.toHaveBeenCalled()
  })

  it.each([
    ['missing listViewId', { object: 'Lead', listViewLabel: 'x' }],
    ['bad object', { object: 'Deal', listViewId: 'lv1', listViewLabel: 'x' }],
    ['empty label', { object: 'Lead', listViewId: 'lv1', listViewLabel: '' }],
    ['label over 200 chars', { object: 'Lead', listViewId: 'lv1', listViewLabel: 'x'.repeat(201) }],
    ['non-JSON body', undefined],
  ])('400 on %s', async (_label, b) => {
    const res = b === undefined
      ? await POST(new Request('http://x/api/salesforce/import', { method: 'POST', body: 'not json' }))
      : await call(b)
    expect(res.status).toBe(400)
    expect(importListView).not.toHaveBeenCalled()
  })

  it('409 when not connected', async () => {
    vi.mocked(requireActiveConnection).mockResolvedValue(
      NextResponse.json({ code: 'NOT_CONNECTED', error: 'Connect Salesforce in Settings first.' }, { status: 409 }),
    )
    const res = await call()
    expect(res.status).toBe(409)
    expect(importListView).not.toHaveBeenCalled()
  })

  it('a member cannot set useSalesforceOwners', async () => {
    await call({ ...body, useSalesforceOwners: true })
    expect(importListView).toHaveBeenCalledWith(expect.objectContaining({ useSalesforceOwners: false }))
  })

  it('an admin can set useSalesforceOwners', async () => {
    vi.mocked(resolveMember).mockResolvedValue(admin as never)
    await call({ ...body, useSalesforceOwners: true })
    expect(importListView).toHaveBeenCalledWith(expect.objectContaining({ useSalesforceOwners: true }))
  })

  it('imports and scores the new leads, returning 201', async () => {
    const res = await call()
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toMatchObject({ batchId: 'batch-1', imported: 2 })
    expect(scoreLeads).toHaveBeenCalledWith({ organizationId: 'org-1', leadIds: ['lead-1', 'lead-2'] })
  })

  it('does not score when nothing was imported', async () => {
    vi.mocked(importListView).mockResolvedValue({ ...importResult, imported: 0, leadIds: [] })
    const res = await call()
    expect(res.status).toBe(201)
    expect(scoreLeads).not.toHaveBeenCalled()
  })

  it('still returns 201 with scoringError when scoring throws', async () => {
    vi.mocked(scoreLeads).mockRejectedValue(new Error('openai down'))
    const res = await call()
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.scoringError).toBeTruthy()
    expect(json.batchId).toBe('batch-1')
  })

  it.each([
    ['SalesforceAuthError', new SalesforceAuthError(), 409],
    ['SalesforceRateLimitError', new SalesforceRateLimitError(), 429],
    ['SalesforceApiError', new SalesforceApiError(500, 'SERVER_ERROR', 'boom'), 502],
  ])('maps %s from importListView', async (_label, err, status) => {
    vi.mocked(importListView).mockRejectedValue(err)
    vi.mocked(salesforceErrorResponse).mockReturnValue(NextResponse.json({ error: 'mapped' }, { status }))
    const res = await call()
    expect(res.status).toBe(status)
    expect(scoreLeads).not.toHaveBeenCalled()
  })
})
