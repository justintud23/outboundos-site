import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    campaign: { findFirst: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getCampaignSender } from './campaign-sender'

type Fn = ReturnType<typeof vi.fn>
const mockFindFirst = prisma.campaign.findFirst as unknown as Fn

beforeEach(() => vi.clearAllMocks())

describe('getCampaignSender', () => {
  it('returns sender fields from the campaign owner', async () => {
    mockFindFirst.mockResolvedValue({ owner: { senderFirstName: 'Mike', senderLastName: 'Rossi' } })
    const result = await getCampaignSender('org-1', 'camp-1')
    expect(result).toEqual({ senderFirstName: 'Mike', senderName: 'Mike Rossi' })
  })

  it('returns nulls when the campaign has no owner', async () => {
    mockFindFirst.mockResolvedValue({ owner: null })
    const result = await getCampaignSender('org-1', 'camp-1')
    expect(result).toEqual({ senderFirstName: null, senderName: null })
  })

  it('returns nulls when the campaign is not found', async () => {
    mockFindFirst.mockResolvedValue(null)
    const result = await getCampaignSender('org-1', 'missing')
    expect(result).toEqual({ senderFirstName: null, senderName: null })
  })

  it('R-J: no Clerk-name fallback — nulls when senderFirstName/senderLastName are unset, even if the owner has a Clerk name', async () => {
    mockFindFirst.mockResolvedValue({ owner: { senderFirstName: null, senderLastName: null, name: 'Michael Rossi' } })
    const result = await getCampaignSender('org-1', 'camp-1')
    expect(result).toEqual({ senderFirstName: null, senderName: null })
  })

  it('trims whitespace-only sender names to null', async () => {
    mockFindFirst.mockResolvedValue({ owner: { senderFirstName: '  ', senderLastName: '  ' } })
    const result = await getCampaignSender('org-1', 'camp-1')
    expect(result).toEqual({ senderFirstName: null, senderName: null })
  })

  it('scopes the query to the campaign id and organization id, and no longer selects the Clerk name', async () => {
    mockFindFirst.mockResolvedValue({ owner: null })
    await getCampaignSender('org-1', 'camp-1')
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: 'camp-1', organizationId: 'org-1' },
      select: { owner: { select: { senderFirstName: true, senderLastName: true } } },
    })
  })
})
