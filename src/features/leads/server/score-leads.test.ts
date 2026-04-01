import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    promptTemplate: { findFirst: vi.fn() },
    lead: { update: vi.fn(), findMany: vi.fn() },
  },
}))

vi.mock('@/lib/ai', () => ({
  getAIProvider: vi.fn(() => ({
    scoreLeads: vi.fn(),
  })),
}))

import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { scoreLeads } from './score-leads'

describe('scoreLeads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scores leads and persists results', async () => {
    const mockLeads = [
      { id: 'lead-1', email: 'a@test.com', firstName: 'A', lastName: null, company: 'Acme', title: 'VP' },
    ]
    const mockTemplate = {
      id: 'tpl-1',
      body: 'Score this lead 0-100 based on ICP fit.',
    }

    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce(mockLeads as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(mockTemplate as never)

    const mockProvider = { scoreLeads: vi.fn().mockResolvedValueOnce([
      { leadId: 'lead-1', score: 80, reason: 'Senior title at known company' },
    ])}
    vi.mocked(getAIProvider).mockReturnValue(mockProvider)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    const results = await scoreLeads({ organizationId: 'org-1', leadIds: ['lead-1'] })

    expect(mockProvider.scoreLeads).toHaveBeenCalledOnce()
    expect(prisma.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1', organizationId: 'org-1' },
        data: expect.objectContaining({ score: 80 }),
      }),
    )
    expect(results[0]).toMatchObject({ leadId: 'lead-1', score: 80, success: true })
  })

  it('uses fallback prompt when no PromptTemplate exists', async () => {
    vi.mocked(prisma.lead.findMany).mockResolvedValueOnce([
      { id: 'lead-2', email: 'b@test.com', firstName: null, lastName: null, company: null, title: null },
    ] as never)
    vi.mocked(prisma.promptTemplate.findFirst).mockResolvedValueOnce(null)

    const mockProvider = { scoreLeads: vi.fn().mockResolvedValueOnce([
      { leadId: 'lead-2', score: 40, reason: 'Limited info available' },
    ])}
    vi.mocked(getAIProvider).mockReturnValue(mockProvider)
    vi.mocked(prisma.lead.update).mockResolvedValue({} as never)

    await scoreLeads({ organizationId: 'org-1', leadIds: ['lead-2'] })

    expect(mockProvider.scoreLeads).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('ICP'), // fallback prompt contains 'ICP'
    )
  })
})
