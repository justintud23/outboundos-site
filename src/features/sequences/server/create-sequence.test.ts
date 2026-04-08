import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    campaign: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import { prisma } from '@/lib/db/prisma'
import { createSequence } from './create-sequence'

const mockCampaignFind = prisma.campaign.findFirst as ReturnType<typeof vi.fn>
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>

const ORG = 'org-1'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('createSequence', () => {
  it('throws if campaign not found', async () => {
    mockCampaignFind.mockResolvedValue(null)

    await expect(
      createSequence({
        organizationId: ORG,
        campaignId: 'bad-id',
        name: 'Test Seq',
        steps: [{ stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0 }],
      }),
    ).rejects.toThrow('Campaign not found')
  })

  it('throws if no steps provided', async () => {
    mockCampaignFind.mockResolvedValue({ id: 'camp-1' })

    await expect(
      createSequence({
        organizationId: ORG,
        campaignId: 'camp-1',
        name: 'Test Seq',
        steps: [],
      }),
    ).rejects.toThrow('at least one step')
  })

  it('creates sequence with steps in transaction', async () => {
    mockCampaignFind.mockResolvedValue({ id: 'camp-1', name: 'Campaign 1' })

    const fakeSequence = {
      id: 'seq-1',
      organizationId: ORG,
      campaignId: 'camp-1',
      name: 'Test Seq',
      createdAt: new Date(),
      steps: [{ id: 'step-1', stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0 }],
    }

    mockTransaction.mockResolvedValue(fakeSequence)

    const result = await createSequence({
      organizationId: ORG,
      campaignId: 'camp-1',
      name: 'Test Seq',
      steps: [{ stepNumber: 1, subject: 'Hi', body: 'Hello', delayDays: 0 }],
    })

    expect(result.id).toBe('seq-1')
    expect(result.name).toBe('Test Seq')
    expect(result.stepCount).toBe(1)
    expect(result.campaignName).toBe('Campaign 1')
    expect(mockTransaction).toHaveBeenCalled()
  })
})
