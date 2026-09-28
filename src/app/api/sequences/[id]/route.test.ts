import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getSequenceOwnerId: vi.fn() }))
vi.mock('@/features/sequences/server/update-sequence', () => ({ updateSequence: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getSequenceOwnerId } from '@/features/team/server/owners'
import { PATCH } from './route'
import { updateSequence } from '@/features/sequences/server/update-sequence'
import { ContentHighRiskError } from '@/features/content-check/types'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown = { name: 'Renamed' }) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'seq-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getSequenceOwnerId).mockResolvedValue('m-rep')
  vi.mocked(updateSequence).mockResolvedValue({ id: 'seq-1', name: 'Renamed' } as never)
})

describe('PATCH /api/sequences/[id]', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('returns 422 CONTENT_HIGH_RISK with findings', async () => {
    vi.mocked(updateSequence).mockRejectedValue(new ContentHighRiskError([{ key: 'step:s:1', label: 'Fall — step 1', subject: 'Re: hi', body: '', isFirstStep: true, level: 'HIGH', findings: [] }]))
    const res = await call()
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('CONTENT_HIGH_RISK')
    expect(body.findings[0].key).toBe('step:s:1')
  })

  it.each([
    ["another rep's sequence", rep, 'm-other', 403],
    ['an unassigned sequence', rep, null, 403],
    ['their own sequence', rep, 'm-rep', 200],
    ['any sequence as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getSequenceOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(updateSequence).not.toHaveBeenCalled()
    }
  })
})
