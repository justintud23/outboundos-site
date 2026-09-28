import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn(async () => ({ id: 'org-1' })) }))
vi.mock('@/features/business-profile/server/rescore', () => ({ rescoreOrganizationLeads: vi.fn() }))

import { auth } from '@clerk/nextjs/server'
import { rescoreOrganizationLeads } from '@/features/business-profile/server/rescore'
import { POST } from './route'

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1' } as never)
})

describe('POST /api/settings/business-profile/rescore', () => {
  it('403 without an org', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null, userId: null } as never)
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(403)
  })

  it('400 on an invalid `since` (not a date)', async () => {
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ since: 'not-a-date' }) }))
    expect(res.status).toBe(400)
    expect(rescoreOrganizationLeads).not.toHaveBeenCalled()
  })

  it('200 passes { since: Date } through and returns the JSON, org-scoped', async () => {
    vi.mocked(rescoreOrganizationLeads).mockResolvedValue({ rescored: 2, remaining: 0, since: '2026-10-01T00:00:00.000Z' })
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ since: '2026-10-01T00:00:00.000Z' }) }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ rescored: 2, remaining: 0, since: '2026-10-01T00:00:00.000Z' })
    expect(rescoreOrganizationLeads).toHaveBeenCalledWith('org-1', { since: new Date('2026-10-01T00:00:00.000Z') })
  })

  it('200 with no body/since', async () => {
    vi.mocked(rescoreOrganizationLeads).mockResolvedValue({ rescored: 0, remaining: 0, since: '2026-10-01T00:00:00.000Z' })
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(200)
    expect(rescoreOrganizationLeads).toHaveBeenCalledWith('org-1', { since: undefined })
  })
})
