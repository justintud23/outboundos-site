import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getSequenceOwnerId: vi.fn() }))
vi.mock('@/features/sequences/server/enroll-lead', () => ({ enrollLead: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { lead: { findMany: vi.fn() } } }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getSequenceOwnerId } from '@/features/team/server/owners'
import { POST } from './route'
import { enrollLead } from '@/features/sequences/server/enroll-lead'
import { prisma } from '@/lib/db/prisma'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown = { leadIds: ['lead-1'] }) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'seq-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getSequenceOwnerId).mockResolvedValue('m-rep')
  vi.mocked(enrollLead).mockResolvedValue({ id: 'enr-1' } as never)
  vi.mocked(prisma.lead.findMany).mockResolvedValue([] as never)
})

describe('POST /api/sequences/[id]/enroll', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it.each([
    ["another rep's sequence", rep, 'm-other', 403],
    ['an unassigned sequence', rep, null, 403],
    ['their own sequence', rep, 'm-rep', 201],
    ['any sequence as admin', admin, 'm-other', 201],
  ])('member enrolling leads on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getSequenceOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(enrollLead).not.toHaveBeenCalled()
    } else {
      expect(enrollLead).toHaveBeenCalledWith(expect.objectContaining({ actorClerkId: ctx.member.clerkUserId }))
    }
  })

  describe('lead ownership', () => {
    const leadIds = ['lead-own', 'lead-unowned', 'lead-other']

    beforeEach(() => {
      vi.mocked(prisma.lead.findMany).mockResolvedValue([
        { id: 'lead-own', ownerId: 'm-rep' },
        { id: 'lead-unowned', ownerId: null },
        { id: 'lead-other', ownerId: 'm-other' },
      ] as never)
      vi.mocked(enrollLead).mockImplementation(async ({ leadId }) => ({ id: `enr-${leadId}` }) as never)
    })

    it('a rep enrolls their own and unowned leads, but is reported NOT_OWNER for another rep\'s lead', async () => {
      const res = await call({ leadIds })
      const body = await res.json() as { results: { leadId: string; success: boolean; code?: string }[] }

      const own = body.results.find((r) => r.leadId === 'lead-own')
      const unowned = body.results.find((r) => r.leadId === 'lead-unowned')
      const other = body.results.find((r) => r.leadId === 'lead-other')

      expect(own?.success).toBe(true)
      expect(unowned?.success).toBe(true)
      expect(other?.success).toBe(false)
      expect(other?.code).toBe('NOT_OWNER')

      expect(enrollLead).toHaveBeenCalledTimes(2)
      expect(enrollLead).not.toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-other' }))
    })

    it('an admin enrolls all three leads regardless of ownership', async () => {
      vi.mocked(resolveMember).mockResolvedValue(admin as never)
      vi.mocked(getSequenceOwnerId).mockResolvedValue('m-other')
      const res = await call({ leadIds })
      const body = await res.json() as { results: { leadId: string; success: boolean }[] }

      expect(body.results.every((r) => r.success)).toBe(true)
      expect(enrollLead).toHaveBeenCalledTimes(3)
    })
  })
})
