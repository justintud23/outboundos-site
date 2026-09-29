import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/salesforce/server/settings', () => ({ updateSalesforceSettings: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { updateSalesforceSettings } from '@/features/salesforce/server/settings'
import { PATCH } from './route'

type Fn = ReturnType<typeof vi.fn>
const mockResolveMember = resolveMember as unknown as Fn
const mockUpdate = updateSalesforceSettings as unknown as Fn

function req(body: unknown) {
  return new Request('http://localhost/api/integrations/salesforce/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const adminCtx = { org: { id: 'org-1' }, member: { id: 'mem-1' }, isAdmin: true }
const memberCtx = { org: { id: 'org-1' }, member: { id: 'mem-2' }, isAdmin: false }

beforeEach(() => {
  vi.clearAllMocks()
  mockUpdate.mockResolvedValue(true)
})

describe('PATCH /api/integrations/salesforce/settings', () => {
  it('returns 403 for a member', async () => {
    mockResolveMember.mockResolvedValue(memberCtx)

    const res = await PATCH(req({ logActivity: false }))

    expect(res.status).toBe(403)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 403 when there is no active organization', async () => {
    mockResolveMember.mockResolvedValue(null)

    const res = await PATCH(req({ logActivity: false }))

    expect(res.status).toBe(403)
  })

  it('returns 400 for an empty body', async () => {
    mockResolveMember.mockResolvedValue(adminCtx)

    const res = await PATCH(req({}))

    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid body (wrong types)', async () => {
    mockResolveMember.mockResolvedValue(adminCtx)

    const res = await PATCH(req({ logActivity: 'yes' }))

    expect(res.status).toBe(400)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('returns 400 when customerAccountTypes has an entry over 80 chars', async () => {
    mockResolveMember.mockResolvedValue(adminCtx)

    const res = await PATCH(req({ customerAccountTypes: ['a'.repeat(81)] }))

    expect(res.status).toBe(400)
  })

  it('returns 409 NOT_CONNECTED when updateSalesforceSettings returns false', async () => {
    mockResolveMember.mockResolvedValue(adminCtx)
    mockUpdate.mockResolvedValue(false)

    const res = await PATCH(req({ logActivity: false }))
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.code).toBe('NOT_CONNECTED')
  })

  it('returns 200 and calls updateSalesforceSettings with the parsed patch', async () => {
    mockResolveMember.mockResolvedValue(adminCtx)

    const res = await PATCH(
      req({ customerAccountTypes: ['Customer', 'Key Account'], blockOpenOpportunities: false, logActivity: true }),
    )

    expect(res.status).toBe(200)
    expect(mockUpdate).toHaveBeenCalledWith('org-1', {
      customerAccountTypes: ['Customer', 'Key Account'],
      blockOpenOpportunities: false,
      logActivity: true,
    })
  })
})
