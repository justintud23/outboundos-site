import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { lead: { findMany: vi.fn(), count: vi.fn() }, organization: { findUnique: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { getLeads } from './get-leads'

type Fn = ReturnType<typeof vi.fn>
const row = (o: Record<string, unknown>) => ({
  id: 'l', email: 'a@acme.com', firstName: null, lastName: null, company: null, title: null, source: 'CSV',
  status: 'NEW', score: null, scoreReason: null, scoredAt: null, createdAt: new Date(),
  phone: null, country: null, customFields: null, ...o,
})

beforeEach(() => {
  vi.resetAllMocks()
  ;(prisma.lead.findMany as Fn).mockResolvedValue([
    row({ id: 'us', email: 'pm@acme.com', phone: '(716) 555-0100' }),
    row({ id: 'ca', email: 'pm@acme.ca' }),
  ])
  ;(prisma.lead.count as Fn).mockResolvedValue(2)
})

describe('getLeads — CASL', () => {
  it('marks Canadian leads with the exclusion reason and strips location fields from the DTO', async () => {
    ;(prisma.organization.findUnique as Fn).mockResolvedValue({ allowCanadianRecipients: false })
    const { leads } = await getLeads({ organizationId: 'org-1' })
    expect(leads.map((l) => [l.id, l.canadaExclusion])).toEqual([['us', null], ['ca', 'email ends in .ca']])
    expect(leads[0]).not.toHaveProperty('phone')
  })

  it('marks nothing when the org allows Canadian recipients', async () => {
    ;(prisma.organization.findUnique as Fn).mockResolvedValue({ allowCanadianRecipients: true })
    const { leads } = await getLeads({ organizationId: 'org-1' })
    expect(leads.every((l) => l.canadaExclusion === null)).toBe(true)
  })
})
