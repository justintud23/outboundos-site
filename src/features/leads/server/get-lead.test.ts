import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findFirst: vi.fn() },
    outboundMessage: { findFirst: vi.fn() },
    inboundReply: { findFirst: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { getLead } from './get-lead'
import { LeadNotFoundError } from '../types'

const mockLeadFindFirst = prisma.lead.findFirst as ReturnType<typeof vi.fn>
const mockOutboundFindFirst = prisma.outboundMessage.findFirst as ReturnType<typeof vi.fn>
const mockInboundFindFirst = prisma.inboundReply.findFirst as ReturnType<typeof vi.fn>

const ORG_ID = 'org-1'
const LEAD_ID = 'lead-1'

const baseLead = {
  id: LEAD_ID,
  email: 'test@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  company: 'Acme',
  title: 'CTO',
  linkedinUrl: null,
  phone: null,
  source: 'CSV',
  status: 'NEW',
  score: 75,
  scoreReason: 'Good fit',
  scoredAt: new Date('2025-01-10'),
  customFields: null,
  createdAt: new Date('2025-01-01'),
  updatedAt: new Date('2025-01-05'),
  ownerId: null,
  owner: null,
  salesforceId: null,
  salesforceType: null,
  sfCheckStatus: null,
  sfCheckDetail: null,
  sfCheckedAt: null,
  sfBlockOverride: false,
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getLead', () => {
  it('returns lead with lastActivityAt from most recent outbound', async () => {
    mockLeadFindFirst.mockResolvedValue(baseLead)
    mockOutboundFindFirst.mockResolvedValue({ sentAt: new Date('2025-01-15') })
    mockInboundFindFirst.mockResolvedValue(null)

    const result = await getLead({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result.id).toBe(LEAD_ID)
    expect(result.lastActivityAt).toEqual(new Date('2025-01-15'))
    expect(mockLeadFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: LEAD_ID, organizationId: ORG_ID },
      }),
    )
  })

  it('returns lead with lastActivityAt from most recent inbound reply', async () => {
    mockLeadFindFirst.mockResolvedValue(baseLead)
    mockOutboundFindFirst.mockResolvedValue({ sentAt: new Date('2025-01-10') })
    mockInboundFindFirst.mockResolvedValue({ receivedAt: new Date('2025-01-20') })

    const result = await getLead({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result.lastActivityAt).toEqual(new Date('2025-01-20'))
  })

  it('falls back to updatedAt when no messages exist', async () => {
    mockLeadFindFirst.mockResolvedValue(baseLead)
    mockOutboundFindFirst.mockResolvedValue(null)
    mockInboundFindFirst.mockResolvedValue(null)

    const result = await getLead({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result.lastActivityAt).toEqual(baseLead.updatedAt)
  })

  it('throws LeadNotFoundError when lead does not exist', async () => {
    mockLeadFindFirst.mockResolvedValue(null)

    await expect(
      getLead({ organizationId: ORG_ID, leadId: 'nonexistent' }),
    ).rejects.toThrow(LeadNotFoundError)
  })

  it('throws LeadNotFoundError for org mismatch (findFirst returns null)', async () => {
    mockLeadFindFirst.mockResolvedValue(null)

    await expect(
      getLead({ organizationId: 'other-org', leadId: LEAD_ID }),
    ).rejects.toThrow(LeadNotFoundError)
  })

  it('returns null ownerId/ownerName when the lead is unowned', async () => {
    mockLeadFindFirst.mockResolvedValue(baseLead)
    mockOutboundFindFirst.mockResolvedValue(null)
    mockInboundFindFirst.mockResolvedValue(null)

    const result = await getLead({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result.ownerId).toBeNull()
    expect(result.ownerName).toBeNull()
  })

  it('returns ownerName from the owner relation, falling back to email', async () => {
    mockLeadFindFirst.mockResolvedValue({
      ...baseLead,
      ownerId: 'm-1',
      owner: { name: null, email: 'owner@x.com' },
    })
    mockOutboundFindFirst.mockResolvedValue(null)
    mockInboundFindFirst.mockResolvedValue(null)

    const result = await getLead({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result.ownerId).toBe('m-1')
    expect(result.ownerName).toBe('owner@x.com')
  })

  it('returns null salesforce fields when the lead is not linked', async () => {
    mockLeadFindFirst.mockResolvedValue(baseLead)
    mockOutboundFindFirst.mockResolvedValue(null)
    mockInboundFindFirst.mockResolvedValue(null)

    const result = await getLead({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result.salesforce).toEqual({
      id: null,
      type: null,
      checkStatus: null,
      checkDetail: null,
      checkedAt: null,
      blockOverride: false,
    })
  })

  it('returns the salesforce block with an ISO checkedAt string', async () => {
    mockLeadFindFirst.mockResolvedValue({
      ...baseLead,
      salesforceId: '00Q123',
      salesforceType: 'LEAD',
      sfCheckStatus: 'CUSTOMER',
      sfCheckDetail: 'Acme',
      sfCheckedAt: new Date('2025-01-20T10:00:00.000Z'),
      sfBlockOverride: true,
    })
    mockOutboundFindFirst.mockResolvedValue(null)
    mockInboundFindFirst.mockResolvedValue(null)

    const result = await getLead({ organizationId: ORG_ID, leadId: LEAD_ID })

    expect(result.salesforce).toEqual({
      id: '00Q123',
      type: 'LEAD',
      checkStatus: 'CUSTOMER',
      checkDetail: 'Acme',
      checkedAt: '2025-01-20T10:00:00.000Z',
      blockOverride: true,
    })
  })
})
