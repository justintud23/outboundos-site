import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findFirst: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { prisma } from '@/lib/db/prisma'
import { POST } from './route'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  lead: { findFirst: Fn; updateMany: Fn }
  auditLog: { create: Fn }
}

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (id = 'lead-1') => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
  p.lead.findFirst.mockResolvedValue({ sfCheckStatus: 'CUSTOMER' })
  p.lead.updateMany.mockResolvedValue({ count: 1 })
  p.auditLog.create.mockResolvedValue({})
})

describe('POST /api/leads/[id]/salesforce-override', () => {
  it('401 without an active member', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    const res = await call()
    expect(res.status).toBe(401)
    expect(p.lead.updateMany).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(p.lead.updateMany).not.toHaveBeenCalled()
  })

  it('404 when the lead is not found in this org', async () => {
    p.lead.updateMany.mockResolvedValue({ count: 0 })
    const res = await call('lead-1')
    expect(res.status).toBe(404)
    expect(p.auditLog.create).not.toHaveBeenCalled()
  })

  it('200, sets sfBlockOverride and clears sfHeldSince, and writes an audit row', async () => {
    const res = await call('lead-1')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })

    expect(p.lead.updateMany).toHaveBeenCalledWith({
      where: { id: 'lead-1', organizationId: 'org-1' },
      data: { sfBlockOverride: true, sfHeldSince: null },
    })

    expect(p.auditLog.create).toHaveBeenCalledWith({
      data: {
        organizationId: 'org-1',
        actorClerkId: 'user_admin',
        action: 'lead.salesforce_override',
        entityType: 'Lead',
        entityId: 'lead-1',
        metadata: { checkStatus: 'CUSTOMER' },
      },
    })
  })

  it('reads the checkStatus before the update, for the audit metadata', async () => {
    p.lead.findFirst.mockResolvedValue({ sfCheckStatus: 'OPEN_OPPORTUNITY' })
    await call('lead-1')

    expect(p.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metadata: { checkStatus: 'OPEN_OPPORTUNITY' } }) }),
    )
  })
})
