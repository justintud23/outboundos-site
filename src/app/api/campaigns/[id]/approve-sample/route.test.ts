import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn().mockResolvedValue({ id: 'org-1' }) }))
vi.mock('@/features/campaigns/server/campaign-sending', async (orig) => ({
  ...(await orig<typeof import('@/features/campaigns/server/campaign-sending')>()),
  approveCampaignSample: vi.fn(),
}))

import { auth } from '@clerk/nextjs/server'
import { approveCampaignSample, CampaignNotFoundError } from '@/features/campaigns/server/campaign-sending'
import { POST } from './route'

const ctx = { params: Promise.resolve({ id: 'c1' }) }
beforeEach(() => vi.clearAllMocks())

describe('POST /api/campaigns/[id]/approve-sample', () => {
  it('403 without an org', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: null, userId: null })
    expect((await POST(new Request('http://x', { method: 'POST' }), ctx)).status).toBe(403)
  })
  it('returns the queued count', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    ;(approveCampaignSample as ReturnType<typeof vi.fn>).mockResolvedValue({ queued: 7 })
    const res = await POST(new Request('http://x', { method: 'POST' }), ctx)
    expect(await res.json()).toEqual({ queued: 7 })
    expect(approveCampaignSample).toHaveBeenCalledWith({ organizationId: 'org-1', campaignId: 'c1', clerkUserId: 'u1' })
  })
  it('404 for an unknown campaign', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    ;(approveCampaignSample as ReturnType<typeof vi.fn>).mockRejectedValue(new CampaignNotFoundError())
    expect((await POST(new Request('http://x', { method: 'POST' }), ctx)).status).toBe(404)
  })
})
