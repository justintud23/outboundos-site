import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getStepOwnerId: vi.fn() }))
vi.mock('@/features/sequences/server/manage-subject-variants', () => ({ createSubjectVariant: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getStepOwnerId } from '@/features/team/server/owners'
import { POST } from './route'
import { createSubjectVariant } from '@/features/sequences/server/manage-subject-variants'
import { ContentHighRiskError } from '@/features/content-check/types'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown = { subject: 'Hi {{firstName}}' }) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ stepId: 'step-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getStepOwnerId).mockResolvedValue('m-rep')
  vi.mocked(createSubjectVariant).mockResolvedValue({ id: 'var-1', subject: 'Hi', isArchived: false } as never)
})

describe('POST /api/sequences/steps/[stepId]/variants', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('returns 422 CONTENT_HIGH_RISK with findings', async () => {
    vi.mocked(createSubjectVariant).mockRejectedValue(new ContentHighRiskError([{ key: 'step:s:1', label: 'Fall — step 1', subject: 'Re: hi', body: '', isFirstStep: true, level: 'HIGH', findings: [] }]))
    const res = await call()
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('CONTENT_HIGH_RISK')
    expect(body.findings[0].key).toBe('step:s:1')
  })

  it.each([
    ["another rep's step", rep, 'm-other', 403],
    ['an unassigned step', rep, null, 403],
    ['their own step', rep, 'm-rep', 201],
    ['any step as admin', admin, 'm-other', 201],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getStepOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(createSubjectVariant).not.toHaveBeenCalled()
    }
  })
})
