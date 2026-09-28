import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn(async () => ({ id: 'org-1' })) }))
vi.mock('@/features/business-profile/server/profile', async (orig) => ({
  ...(await orig<typeof import('@/features/business-profile/server/profile')>()),
  getBusinessProfile: vi.fn(),
  saveBusinessProfile: vi.fn(),
}))

import { auth } from '@clerk/nextjs/server'
import { getBusinessProfile, saveBusinessProfile, ProfileValidationError } from '@/features/business-profile/server/profile'
import { GET, PUT } from './route'

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1' } as never)
})

describe('/api/settings/business-profile', () => {
  it('403 without an org', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null, userId: null } as never)
    expect((await GET()).status).toBe(403)
  })

  it('GET returns the org profile (or null)', async () => {
    vi.mocked(getBusinessProfile).mockResolvedValue(null)
    const res = await GET()
    expect(await res.json()).toEqual({ profile: null })
    expect(getBusinessProfile).toHaveBeenCalledWith('org-1')
  })

  it('PUT saves and returns the profile', async () => {
    vi.mocked(saveBusinessProfile).mockResolvedValue({ preset: 'blank' } as never)
    const res = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({ preset: 'blank' }) }))
    expect(res.status).toBe(200)
    expect(saveBusinessProfile).toHaveBeenCalledWith('org-1', { preset: 'blank' })
  })

  it('PUT maps validation errors to 400 and bad JSON to 400', async () => {
    vi.mocked(saveBusinessProfile).mockRejectedValue(new ProfileValidationError('Add at least one yard (ZIP and radius)'))
    const res = await PUT(new Request('http://x', { method: 'PUT', body: JSON.stringify({}) }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('yard')
    expect((await PUT(new Request('http://x', { method: 'PUT', body: 'nope' }))).status).toBe(400)
  })
})
