import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getDraftOwnerId: vi.fn() }))
vi.mock('@/features/drafts/server/review-draft', () => ({ reviewDraft: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getDraftOwnerId } from '@/features/team/server/owners'
import { reviewDraft } from '@/features/drafts/server/review-draft'
import { DraftNotFoundError, DraftNotPendingError } from '@/features/drafts/types'
import { PATCH } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown = { action: 'approve' }) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'draft-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getDraftOwnerId).mockResolvedValue('m-rep')
  vi.mocked(reviewDraft).mockResolvedValue({ id: 'draft-1', status: 'APPROVED' } as never)
})

describe('PATCH /api/drafts/[id]/review', () => {
  it('403 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(403)
  })

  it('400 when action is not approve or reject', async () => {
    const res = await call({ action: 'delete' })
    expect(res.status).toBe(400)
    expect(reviewDraft).not.toHaveBeenCalled()
  })

  it('404 when the draft is not found', async () => {
    vi.mocked(reviewDraft).mockRejectedValue(new DraftNotFoundError())
    expect((await call()).status).toBe(404)
  })

  it('409 DRAFT_NOT_PENDING', async () => {
    vi.mocked(reviewDraft).mockRejectedValue(new DraftNotPendingError('APPROVED'))
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('DRAFT_NOT_PENDING')
  })

  it.each([
    ["another rep's draft", rep, 'm-other', 403],
    ['an unassigned draft', rep, null, 403],
    ['their own draft', rep, 'm-rep', 200],
    ['any draft as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getDraftOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(reviewDraft).not.toHaveBeenCalled()
    }
  })

  it('reviews with the caller\'s clerkUserId as actor', async () => {
    await call()
    expect(reviewDraft).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user_rep', action: 'approve' }),
    )
  })
})
