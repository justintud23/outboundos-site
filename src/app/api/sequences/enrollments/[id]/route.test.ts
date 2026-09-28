import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getEnrollmentOwnerId: vi.fn() }))
vi.mock('@/features/sequences/server/update-enrollment', () => ({ updateEnrollment: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getEnrollmentOwnerId } from '@/features/team/server/owners'
import { PATCH } from './route'
import { updateEnrollment } from '@/features/sequences/server/update-enrollment'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown = { action: 'pause' }) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'enr-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getEnrollmentOwnerId).mockResolvedValue('m-rep')
  vi.mocked(updateEnrollment).mockResolvedValue({ id: 'enr-1', status: 'PAUSED' } as never)
})

describe('PATCH /api/sequences/enrollments/[id]', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it.each([
    ["another rep's enrollment", rep, 'm-other', 403],
    ['an unassigned enrollment', rep, null, 403],
    ['their own enrollment', rep, 'm-rep', 200],
    ['any enrollment as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getEnrollmentOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(updateEnrollment).not.toHaveBeenCalled()
    } else {
      expect(updateEnrollment).toHaveBeenCalledWith(expect.objectContaining({ actorClerkId: ctx.member.clerkUserId }))
    }
  })
})
