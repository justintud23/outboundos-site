import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    campaign: { findFirst: vi.fn() },
    sequence: { findFirst: vi.fn() },
    sequenceStep: { findFirst: vi.fn() },
    subjectVariant: { findFirst: vi.fn() },
    sequenceEnrollment: { findFirst: vi.fn() },
    draft: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn() },
    outboundMessage: { findFirst: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import {
  getCampaignOwnerId,
  getSequenceOwnerId,
  getStepOwnerId,
  getVariantOwnerId,
  getEnrollmentOwnerId,
  getDraftOwnerId,
  getLeadOwnerId,
  getMessageOwnerId,
} from './owners'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as Record<string, Record<string, Fn>>

beforeEach(() => vi.clearAllMocks())

describe('getCampaignOwnerId', () => {
  it('queries by id + org and returns ownerId', async () => {
    p.campaign!.findFirst!.mockResolvedValue({ ownerId: 'm-1' })
    const result = await getCampaignOwnerId('org-1', 'c1')
    expect(p.campaign!.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org-1' },
      select: { ownerId: true },
    })
    expect(result).toBe('m-1')
  })
  it('returns null for an unassigned campaign', async () => {
    p.campaign!.findFirst!.mockResolvedValue({ ownerId: null })
    expect(await getCampaignOwnerId('org-1', 'c1')).toBeNull()
  })
  it('returns undefined when not found', async () => {
    p.campaign!.findFirst!.mockResolvedValue(null)
    expect(await getCampaignOwnerId('org-1', 'missing')).toBeUndefined()
  })
})

describe('getSequenceOwnerId', () => {
  it('queries through campaign and returns ownerId', async () => {
    p.sequence!.findFirst!.mockResolvedValue({ campaign: { ownerId: 'm-1' } })
    const result = await getSequenceOwnerId('org-1', 's1')
    expect(p.sequence!.findFirst).toHaveBeenCalledWith({
      where: { id: 's1', organizationId: 'org-1' },
      select: { campaign: { select: { ownerId: true } } },
    })
    expect(result).toBe('m-1')
  })
  it('returns null for an unassigned campaign', async () => {
    p.sequence!.findFirst!.mockResolvedValue({ campaign: { ownerId: null } })
    expect(await getSequenceOwnerId('org-1', 's1')).toBeNull()
  })
  it('returns undefined when not found', async () => {
    p.sequence!.findFirst!.mockResolvedValue(null)
    expect(await getSequenceOwnerId('org-1', 'missing')).toBeUndefined()
  })
})

describe('getStepOwnerId', () => {
  it('queries through sequence.campaign and returns ownerId', async () => {
    p.sequenceStep!.findFirst!.mockResolvedValue({ sequence: { campaign: { ownerId: 'm-1' } } })
    const result = await getStepOwnerId('org-1', 'st1')
    expect(p.sequenceStep!.findFirst).toHaveBeenCalledWith({
      where: { id: 'st1', sequence: { organizationId: 'org-1' } },
      select: { sequence: { select: { campaign: { select: { ownerId: true } } } } },
    })
    expect(result).toBe('m-1')
  })
  it('returns null for an unassigned campaign', async () => {
    p.sequenceStep!.findFirst!.mockResolvedValue({ sequence: { campaign: { ownerId: null } } })
    expect(await getStepOwnerId('org-1', 'st1')).toBeNull()
  })
  it('returns undefined when not found', async () => {
    p.sequenceStep!.findFirst!.mockResolvedValue(null)
    expect(await getStepOwnerId('org-1', 'missing')).toBeUndefined()
  })
})

describe('getVariantOwnerId', () => {
  it('queries through sequenceStep.sequence.campaign and returns ownerId', async () => {
    p.subjectVariant!.findFirst!.mockResolvedValue({ sequenceStep: { sequence: { campaign: { ownerId: 'm-1' } } } })
    const result = await getVariantOwnerId('org-1', 'v1')
    expect(p.subjectVariant!.findFirst).toHaveBeenCalledWith({
      where: { id: 'v1', organizationId: 'org-1' },
      select: { sequenceStep: { select: { sequence: { select: { campaign: { select: { ownerId: true } } } } } } },
    })
    expect(result).toBe('m-1')
  })
  it('returns null for an unassigned campaign', async () => {
    p.subjectVariant!.findFirst!.mockResolvedValue({ sequenceStep: { sequence: { campaign: { ownerId: null } } } })
    expect(await getVariantOwnerId('org-1', 'v1')).toBeNull()
  })
  it('returns undefined when not found', async () => {
    p.subjectVariant!.findFirst!.mockResolvedValue(null)
    expect(await getVariantOwnerId('org-1', 'missing')).toBeUndefined()
  })
})

describe('getEnrollmentOwnerId', () => {
  it('queries through sequence.campaign and returns ownerId', async () => {
    p.sequenceEnrollment!.findFirst!.mockResolvedValue({ sequence: { campaign: { ownerId: 'm-1' } } })
    const result = await getEnrollmentOwnerId('org-1', 'e1')
    expect(p.sequenceEnrollment!.findFirst).toHaveBeenCalledWith({
      where: { id: 'e1', organizationId: 'org-1' },
      select: { sequence: { select: { campaign: { select: { ownerId: true } } } } },
    })
    expect(result).toBe('m-1')
  })
  it('returns null for an unassigned campaign', async () => {
    p.sequenceEnrollment!.findFirst!.mockResolvedValue({ sequence: { campaign: { ownerId: null } } })
    expect(await getEnrollmentOwnerId('org-1', 'e1')).toBeNull()
  })
  it('returns undefined when not found', async () => {
    p.sequenceEnrollment!.findFirst!.mockResolvedValue(null)
    expect(await getEnrollmentOwnerId('org-1', 'missing')).toBeUndefined()
  })
})

describe('getDraftOwnerId', () => {
  it('queries with campaign and lead owner select, and returns the campaign owner when the draft has a campaign', async () => {
    p.draft!.findFirst!.mockResolvedValue({ campaign: { ownerId: 'm-campaign' }, lead: { ownerId: 'm-lead' } })
    const result = await getDraftOwnerId('org-1', 'd1')
    expect(p.draft!.findFirst).toHaveBeenCalledWith({
      where: { id: 'd1', organizationId: 'org-1' },
      select: { campaign: { select: { ownerId: true } }, lead: { select: { ownerId: true } } },
    })
    expect(result).toBe('m-campaign')
  })
  it('falls back to the lead owner when the draft has no campaign', async () => {
    p.draft!.findFirst!.mockResolvedValue({ campaign: null, lead: { ownerId: 'm-lead' } })
    expect(await getDraftOwnerId('org-1', 'd1')).toBe('m-lead')
  })
  it('returns null when both campaign and lead are unassigned', async () => {
    p.draft!.findFirst!.mockResolvedValue({ campaign: null, lead: { ownerId: null } })
    expect(await getDraftOwnerId('org-1', 'd1')).toBeNull()
  })
  it('returns undefined when not found', async () => {
    p.draft!.findFirst!.mockResolvedValue(null)
    expect(await getDraftOwnerId('org-1', 'missing')).toBeUndefined()
  })
})

describe('getLeadOwnerId', () => {
  it('queries by id + org and returns ownerId', async () => {
    p.lead!.findFirst!.mockResolvedValue({ ownerId: 'm-1' })
    const result = await getLeadOwnerId('org-1', 'l1')
    expect(p.lead!.findFirst).toHaveBeenCalledWith({
      where: { id: 'l1', organizationId: 'org-1' },
      select: { ownerId: true },
    })
    expect(result).toBe('m-1')
  })
  it('returns null for an unassigned lead', async () => {
    p.lead!.findFirst!.mockResolvedValue({ ownerId: null })
    expect(await getLeadOwnerId('org-1', 'l1')).toBeNull()
  })
  it('returns undefined when not found', async () => {
    p.lead!.findFirst!.mockResolvedValue(null)
    expect(await getLeadOwnerId('org-1', 'missing')).toBeUndefined()
  })
})

describe('getMessageOwnerId', () => {
  it('queries through lead and returns ownerId', async () => {
    p.outboundMessage!.findFirst!.mockResolvedValue({ lead: { ownerId: 'm-1' } })
    const result = await getMessageOwnerId('org-1', 'msg1')
    expect(p.outboundMessage!.findFirst).toHaveBeenCalledWith({
      where: { id: 'msg1', organizationId: 'org-1' },
      select: { lead: { select: { ownerId: true } } },
    })
    expect(result).toBe('m-1')
  })
  it('returns null for an unassigned lead', async () => {
    p.outboundMessage!.findFirst!.mockResolvedValue({ lead: { ownerId: null } })
    expect(await getMessageOwnerId('org-1', 'msg1')).toBeNull()
  })
  it('returns undefined when not found', async () => {
    p.outboundMessage!.findFirst!.mockResolvedValue(null)
    expect(await getMessageOwnerId('org-1', 'missing')).toBeUndefined()
  })
})
