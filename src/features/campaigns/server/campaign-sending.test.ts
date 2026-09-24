import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { campaign: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }, $transaction: vi.fn() },
}))

import { prisma } from '@/lib/db/prisma'
import { approveCampaignSample, updateCampaignSending, createCampaign, CampaignNotFoundError } from './campaign-sending'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { campaign: { findFirst: Fn; create: Fn; update: Fn }; $transaction: Fn }
beforeEach(() => vi.resetAllMocks())

describe('approveCampaignSample', () => {
  it('approves pending sample drafts, queues every unsent sample draft, stamps sampleApprovedAt', async () => {
    p.campaign.findFirst.mockResolvedValue({ id: 'c1', autoSend: true })
    const draftUpdateMany = vi.fn().mockResolvedValue({ count: 2 })
    const sampleDrafts = [
      { id: 'd1', organizationId: 'org-1', leadId: 'l1', campaignId: 'c1', subject: 'S', body: 'B', subjectVariantId: null, subjectEdited: false, sequenceEnrollment: { mailboxId: 'mb-1' } },
      { id: 'd2', organizationId: 'org-1', leadId: 'l2', campaignId: 'c1', subject: 'S', body: 'B', subjectVariantId: null, subjectEdited: false, sequenceEnrollment: { mailboxId: 'mb-2' } },
      { id: 'd3', organizationId: 'org-1', leadId: 'l3', campaignId: 'c1', subject: 'S', body: 'B', subjectVariantId: null, subjectEdited: false, sequenceEnrollment: { mailboxId: null } },
    ]
    const findMany = vi.fn().mockResolvedValue(sampleDrafts)
    const messageCreate = vi.fn().mockResolvedValue({})
    const campaignUpdate = vi.fn().mockResolvedValue({})
    p.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        draft: { updateMany: draftUpdateMany, findMany },
        outboundMessage: { create: messageCreate },
        campaign: { update: campaignUpdate },
        auditLog: { create: vi.fn() },
      }),
    )

    const out = await approveCampaignSample({ organizationId: 'org-1', campaignId: 'c1', clerkUserId: 'u1' })

    expect(draftUpdateMany).toHaveBeenCalledWith({
      where: { campaignId: 'c1', organizationId: 'org-1', isSample: true, status: 'PENDING_REVIEW' },
      data: { status: 'APPROVED', approvedByClerkId: 'u1', approvedAt: expect.any(Date) },
    })
    expect(messageCreate).toHaveBeenCalledTimes(2) // d3 has no mailbox yet → skipped
    expect(findMany.mock.calls[0][0].where).toMatchObject({ campaignId: 'c1', organizationId: 'org-1', isSample: true }) // T11
    expect(campaignUpdate).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { sampleApprovedAt: expect.any(Date) } })
    expect(out).toEqual({ queued: 2 })
  })

  it('queues a step-2 sample draft only when its step 1 was SENT (I1)', async () => {
    p.campaign.findFirst.mockResolvedValue({ id: 'c1', autoSend: true })
    const base = { organizationId: 'org-1', campaignId: 'c1', subject: 'S', body: 'B', subjectVariantId: null, subjectEdited: false }
    const drafts = [
      { ...base, id: 's1', leadId: 'l1', sequenceEnrollmentId: 'e1', sequenceStep: { stepNumber: 1 }, sequenceEnrollment: { mailboxId: 'mb-1' } },
      { ...base, id: 's2-unsent', leadId: 'l1', sequenceEnrollmentId: 'e1', sequenceStep: { stepNumber: 2 }, sequenceEnrollment: { mailboxId: 'mb-1' } },
      { ...base, id: 's2-ok', leadId: 'l2', sequenceEnrollmentId: 'e2', sequenceStep: { stepNumber: 2 }, sequenceEnrollment: { mailboxId: 'mb-1' } },
    ]
    const count = vi.fn(async ({ where }: { where: { draft: { sequenceEnrollmentId: string } } }) =>
      where.draft.sequenceEnrollmentId === 'e2' ? 1 : 0,
    )
    const messageCreate = vi.fn().mockResolvedValue({})
    p.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
        draft: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findMany: vi.fn().mockResolvedValue(drafts) },
        outboundMessage: { create: messageCreate, count },
        campaign: { update: vi.fn() },
        auditLog: { create: vi.fn() },
      }),
    )

    const out = await approveCampaignSample({ organizationId: 'org-1', campaignId: 'c1', clerkUserId: 'u1' })

    expect(out).toEqual({ queued: 2 })
    expect(messageCreate.mock.calls.map((c) => c[0].data.draftId)).toEqual(['s1', 's2-ok'])
    expect(count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        sentAt: { not: null },
        draft: { sequenceEnrollmentId: 'e1', sequenceStep: { stepNumber: 1 } },
      },
    })
  })

  it('throws CampaignNotFoundError for another org', async () => {
    p.campaign.findFirst.mockResolvedValue(null)
    await expect(approveCampaignSample({ organizationId: 'org-1', campaignId: 'x', clerkUserId: 'u1' })).rejects.toBeInstanceOf(CampaignNotFoundError)
  })
})

describe('updateCampaignSending', () => {
  it('clamps sampleSize to 1..50', async () => {
    p.campaign.findFirst.mockResolvedValue({ id: 'c1' })
    p.campaign.update.mockResolvedValue({ id: 'c1', autoSend: true, sampleSize: 50, sampleApprovedAt: null })
    await updateCampaignSending({ organizationId: 'org-1', campaignId: 'c1', autoSend: true, sampleSize: 500 })
    expect(p.campaign.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { autoSend: true, sampleSize: 50 },
      select: { id: true, autoSend: true, sampleSize: true, sampleApprovedAt: true },
    })
  })
})

describe('createCampaign', () => {
  it('creates an ACTIVE campaign with a trimmed name', async () => {
    p.campaign.create.mockResolvedValue({ id: 'c9', name: 'Buffalo HOAs' })
    await createCampaign({ organizationId: 'org-1', name: '  Buffalo HOAs ' })
    expect(p.campaign.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', name: 'Buffalo HOAs', description: null, status: 'ACTIVE' },
      select: { id: true, name: true },
    })
  })
})
