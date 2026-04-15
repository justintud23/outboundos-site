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
})
