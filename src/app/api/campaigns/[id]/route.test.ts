import { describe, it, expect, vi } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(async () => ({ orgId: 'clerk-org' })) }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn(async () => ({ id: 'org-1' })) }))
vi.mock('@/features/campaigns/server/campaign-sending', async (orig) => ({
  ...(await orig<typeof import('@/features/campaigns/server/campaign-sending')>()),
  updateCampaignSending: vi.fn(),
}))

import { PATCH } from './route'
import { updateCampaignSending } from '@/features/campaigns/server/campaign-sending'
import { ContentHighRiskError } from '@/features/content-check/types'

describe('PATCH /api/campaigns/[id]', () => {
  it('returns 422 CONTENT_HIGH_RISK with findings', async () => {
    vi.mocked(updateCampaignSending).mockRejectedValue(new ContentHighRiskError([{ key: 'step:s:1', label: 'Fall — step 1', subject: 'Re: hi', body: '', isFirstStep: true, level: 'HIGH', findings: [] }]))
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify({ autoSend: true }) }), { params: Promise.resolve({ id: 'camp-1' }) })
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('CONTENT_HIGH_RISK')
    expect(body.findings[0].key).toBe('step:s:1')
  })
})
