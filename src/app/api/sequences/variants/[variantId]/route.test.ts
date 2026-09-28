import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getVariantOwnerId: vi.fn() }))
vi.mock('@/features/sequences/server/manage-subject-variants', () => ({
  updateSubjectVariant: vi.fn(),
  archiveSubjectVariant: vi.fn(),
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getVariantOwnerId } from '@/features/team/server/owners'
import { PATCH, DELETE } from './route'
import { updateSubjectVariant, archiveSubjectVariant } from '@/features/sequences/server/manage-subject-variants'
import { ContentHighRiskError } from '@/features/content-check/types'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const callPatch = (body: unknown = { subject: 'New subject' }) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ variantId: 'var-1' }) })

const callDelete = () =>
  DELETE(new Request('http://x', { method: 'DELETE' }), { params: Promise.resolve({ variantId: 'var-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getVariantOwnerId).mockResolvedValue('m-rep')
  vi.mocked(updateSubjectVariant).mockResolvedValue({ id: 'var-1', subject: 'New subject', isArchived: false } as never)
  vi.mocked(archiveSubjectVariant).mockResolvedValue(undefined as never)
})

describe('PATCH /api/sequences/variants/[variantId]', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await callPatch()).status).toBe(401)
  })

  it('returns 422 CONTENT_HIGH_RISK with findings', async () => {
    vi.mocked(updateSubjectVariant).mockRejectedValue(new ContentHighRiskError([{ key: 'step:s:1', label: 'Fall — step 1', subject: 'Re: hi', body: '', isFirstStep: true, level: 'HIGH', findings: [] }]))
    const res = await callPatch()
    expect(res.status).toBe(422)
    const body = await res.json()
    expect(body.code).toBe('CONTENT_HIGH_RISK')
    expect(body.findings[0].key).toBe('step:s:1')
  })

  it.each([
    ["another rep's variant", rep, 'm-other', 403],
    ['an unassigned variant', rep, null, 403],
    ['their own variant', rep, 'm-rep', 200],
    ['any variant as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getVariantOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await callPatch()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(updateSubjectVariant).not.toHaveBeenCalled()
    }
  })
})

describe('DELETE /api/sequences/variants/[variantId]', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await callDelete()).status).toBe(401)
  })

  it.each([
    ["another rep's variant", rep, 'm-other', 403],
    ['an unassigned variant', rep, null, 403],
    ['their own variant', rep, 'm-rep', 200],
    ['any variant as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getVariantOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await callDelete()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(archiveSubjectVariant).not.toHaveBeenCalled()
    }
  })
})
