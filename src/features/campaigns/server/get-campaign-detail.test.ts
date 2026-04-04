import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    campaign:       { findFirst: vi.fn() },
    draft:          { findMany: vi.fn(), groupBy: vi.fn() },
    inboundReply:   { findMany: vi.fn(), count: vi.fn() },
    outboundMessage: { count: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getCampaignDetail } from './get-campaign-detail'

const mockCampaign   = prisma.campaign.findFirst     as ReturnType<typeof vi.fn>
const mockDraftMany  = prisma.draft.findMany         as ReturnType<typeof vi.fn>
const mockDraftGroup = prisma.draft.groupBy          as ReturnType<typeof vi.fn>
const mockReplyMany  = prisma.inboundReply.findMany  as ReturnType<typeof vi.fn>
const mockReplyCount = prisma.inboundReply.count     as ReturnType<typeof vi.fn>
const mockMsgCount   = prisma.outboundMessage.count  as ReturnType<typeof vi.fn>

const fakeCampaign = {
  id:             'camp-1',
  organizationId: 'org-1',
  name:           'Q2 Outreach',
  description:    'Cold outreach to SaaS founders',
  status:         'ACTIVE',
  createdAt:      new Date('2026-01-15'),
  updatedAt:      new Date('2026-01-15'),
}

const fakeDraft = {
  id:          'draft-1',
  subject:     'Hello Jane',
  status:      'PENDING_REVIEW',
  createdAt:   new Date('2026-01-20'),
  lead: {
    id:        'lead-1',
    email:     'jane@acme.com',
    firstName: 'Jane',
    lastName:  'Doe',
    company:   'Acme',
  },
}

const fakeReply = {
  id:                       'reply-1',
  classification:           'POSITIVE',
  classificationConfidence: 0.92,
  rawBody:                  'Thanks for reaching out!',
  receivedAt:               new Date('2026-02-01'),
  lead: { email: 'jane@acme.com' },
}

beforeEach(() => vi.clearAllMocks())

function setupHappyPath() {
  mockCampaign.mockResolvedValue(fakeCampaign)
  mockDraftMany.mockResolvedValue([fakeDraft])
  mockReplyMany.mockResolvedValue([fakeReply])
  mockReplyCount
    .mockResolvedValueOnce(1)   // total replies
    .mockResolvedValueOnce(1)   // positive replies
  mockMsgCount.mockResolvedValue(5)
  mockDraftGroup.mockResolvedValue([
    { status: 'PENDING_REVIEW', _count: { _all: 1 } },
  ])
}

describe('getCampaignDetail', () => {
  it('returns campaign detail with drafts and replies', async () => {
    setupHappyPath()

    const result = await getCampaignDetail({ organizationId: 'org-1', campaignId: 'camp-1' })

    expect(result).not.toBeNull()
    expect(result!.name).toBe('Q2 Outreach')
    expect(result!.status).toBe('ACTIVE')
    expect(result!.drafts).toHaveLength(1)
    expect(result!.drafts[0]?.subject).toBe('Hello Jane')
    expect(result!.replies).toHaveLength(1)
    expect(result!.replies[0]?.classification).toBe('POSITIVE')
  })

  it('returns null when campaign is not found', async () => {
    mockCampaign.mockResolvedValue(null)

    const result = await getCampaignDetail({ organizationId: 'org-1', campaignId: 'nonexistent' })

    expect(result).toBeNull()
    // Should not query dependent tables when campaign is missing
    expect(mockDraftMany).not.toHaveBeenCalled()
    expect(mockReplyMany).not.toHaveBeenCalled()
  })

  it('returns null when campaign belongs to a different org', async () => {
    mockCampaign.mockResolvedValue(null) // findFirst returns null for wrong org

    const result = await getCampaignDetail({ organizationId: 'org-OTHER', campaignId: 'camp-1' })

    expect(result).toBeNull()
  })

  it('scopes campaign lookup to organizationId', async () => {
    mockCampaign.mockResolvedValue(null)

    await getCampaignDetail({ organizationId: 'org-abc', campaignId: 'camp-1' })

    expect(mockCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'camp-1', organizationId: 'org-abc' },
      }),
    )
  })

  it('scopes draft query to organizationId and campaignId', async () => {
    setupHappyPath()

    await getCampaignDetail({ organizationId: 'org-1', campaignId: 'camp-1' })

    expect(mockDraftMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId: 'camp-1', organizationId: 'org-1' },
      }),
    )
  })

  it('correctly calculates draftPendingCount from groupBy results', async () => {
    mockCampaign.mockResolvedValue(fakeCampaign)
    mockDraftMany.mockResolvedValue([])
    mockReplyMany.mockResolvedValue([])
    mockReplyCount.mockResolvedValue(0)
    mockMsgCount.mockResolvedValue(0)
    mockDraftGroup.mockResolvedValue([
      { status: 'PENDING_REVIEW', _count: { _all: 4 } },
      { status: 'APPROVED',       _count: { _all: 2 } },
      { status: 'REJECTED',       _count: { _all: 1 } },
    ])

    const result = await getCampaignDetail({ organizationId: 'org-1', campaignId: 'camp-1' })

    expect(result!.draftPendingCount).toBe(4)
    expect(result!.draftApprovedCount).toBe(2)
    expect(result!.draftTotal).toBe(7)
  })

  it('returns zero counts when no related data exists', async () => {
    mockCampaign.mockResolvedValue(fakeCampaign)
    mockDraftMany.mockResolvedValue([])
    mockReplyMany.mockResolvedValue([])
    mockReplyCount.mockResolvedValue(0)
    mockMsgCount.mockResolvedValue(0)
    mockDraftGroup.mockResolvedValue([])

    const result = await getCampaignDetail({ organizationId: 'org-1', campaignId: 'camp-1' })

    expect(result!.messageCount).toBe(0)
    expect(result!.draftTotal).toBe(0)
    expect(result!.draftPendingCount).toBe(0)
    expect(result!.replyCount).toBe(0)
    expect(result!.positiveReplyCount).toBe(0)
    expect(result!.drafts).toEqual([])
    expect(result!.replies).toEqual([])
  })

  it('maps reply leadEmail from nested lead relation', async () => {
    setupHappyPath()

    const result = await getCampaignDetail({ organizationId: 'org-1', campaignId: 'camp-1' })

    expect(result!.replies[0]?.leadEmail).toBe('jane@acme.com')
  })

  it('maps draft lead fields correctly', async () => {
    setupHappyPath()

    const result = await getCampaignDetail({ organizationId: 'org-1', campaignId: 'camp-1' })

    const draft = result!.drafts[0]!
    expect(draft.lead.email).toBe('jane@acme.com')
    expect(draft.lead.firstName).toBe('Jane')
    expect(draft.lead.company).toBe('Acme')
  })
})
