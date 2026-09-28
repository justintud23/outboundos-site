import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/campaigns/server/campaign-sending', async (orig) => ({
  ...(await orig<typeof import('@/features/campaigns/server/campaign-sending')>()),
  createCampaign: vi.fn(),
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { createCampaign } from '@/features/campaigns/server/campaign-sending'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }

const call = (body: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(createCampaign).mockResolvedValue({ id: 'c1', name: 'Buffalo HOAs' })
})

describe('POST /api/campaigns', () => {
  it('403 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call({ name: 'Buffalo HOAs' })).status).toBe(403)
  })

  it('400 without a name', async () => {
    expect((await call({})).status).toBe(400)
    expect((await call({ name: '  ' })).status).toBe(400)
  })

  it('201 creates a campaign owned by the signed-in member', async () => {
    const res = await call({ name: 'Buffalo HOAs', description: 'HOA board members' })
    expect(res.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith({
      organizationId: 'org-1',
      name: 'Buffalo HOAs',
      description: 'HOA board members',
      ownerId: 'm-rep',
    })
  })

  it('a member (not admin) can create a campaign, owned by themselves', async () => {
    const res = await call({ name: 'Buffalo HOAs' })
    expect(res.status).toBe(201)
    expect(createCampaign).toHaveBeenCalledWith(expect.objectContaining({ ownerId: 'm-rep' }))
  })
})
