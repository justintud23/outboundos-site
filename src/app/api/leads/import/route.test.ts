import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn() }))
vi.mock('@/features/leads/server/import-csv', () => ({ importCsv: vi.fn() }))
vi.mock('@/features/leads/server/score-leads', () => ({ scoreLeads: vi.fn() }))

import { auth } from '@clerk/nextjs/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { importCsv } from '@/features/leads/server/import-csv'
import { scoreLeads } from '@/features/leads/server/score-leads'
import { POST } from './route'

function makeRequest(): Request {
  const formData = new FormData()
  formData.append('file', new File(['email\na@x.com'], 'leads.csv', { type: 'text/csv' }))
  return new Request('http://x', { method: 'POST', body: formData })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org' } as never)
  vi.mocked(resolveOrganization).mockResolvedValue({ id: 'org-1' } as never)
  vi.mocked(importCsv).mockResolvedValue({ leads: [{ id: 'lead-1' }], errors: [], totalRows: 1 } as never)
  vi.mocked(scoreLeads).mockResolvedValue([{ leadId: 'lead-1', score: 80 }] as never)
})

describe('POST /api/leads/import', () => {
  // This route is any-member (not owner- or admin-gated) — a non-admin
  // member's import must still succeed.
  it('a non-admin member can still import leads', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.leads).toEqual([{ id: 'lead-1' }])
    expect(importCsv).toHaveBeenCalledWith(expect.objectContaining({ organizationId: 'org-1' }))
  })
})
