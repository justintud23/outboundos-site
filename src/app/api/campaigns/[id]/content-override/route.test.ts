import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn(async () => ({ id: 'org-1' })) }))
vi.mock('@/features/content-check/server/content-gate', () => ({ recordContentOverride: vi.fn() }))

import { auth } from '@clerk/nextjs/server'
import { recordContentOverride } from '@/features/content-check/server/content-gate'
import { ContentOverrideValidationError } from '@/features/content-check/types'
import { POST } from './route'

const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'camp-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1' } as never)
})

describe('POST /api/campaigns/[id]/content-override', () => {
  it('403 without an org', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null, userId: null } as never)
    expect((await call({ reason: 'long enough reason' })).status).toBe(403)
  })

  it('400 without a reason, and on a validation error', async () => {
    expect((await call({})).status).toBe(400)
    vi.mocked(recordContentOverride).mockRejectedValue(new ContentOverrideValidationError('Give a reason of 10–500 characters.'))
    expect((await call({ reason: 'short' })).status).toBe(400)
  })

  it('404 for another org\'s campaign', async () => {
    vi.mocked(recordContentOverride).mockResolvedValue(null)
    expect((await call({ reason: 'long enough reason' })).status).toBe(404)
  })

  it('200 records the override org-scoped with the signed-in user', async () => {
    vi.mocked(recordContentOverride).mockResolvedValue({ level: 'HIGH', items: [], override: { reason: 'long enough reason', by: 'user_1', at: '2026-10-01T00:00:00.000Z', valid: true } })
    const res = await call({ reason: 'long enough reason' })
    expect(res.status).toBe(200)
    expect(recordContentOverride).toHaveBeenCalledWith({ organizationId: 'org-1', campaignId: 'camp-1', clerkUserId: 'user_1', reason: 'long enough reason' })
  })
})
