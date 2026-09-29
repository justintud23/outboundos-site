import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/assign-owner', () => ({
  assignOwner: vi.fn(),
  InvalidOwnerError: class InvalidOwnerError extends Error {},
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { assignOwner, InvalidOwnerError } from '@/features/team/server/assign-owner'
import { PATCH } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

function call(body: unknown = { ownerId: 'm-1' }) {
  return PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'camp-1' }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
  vi.mocked(assignOwner).mockResolvedValue(true)
})

describe('PATCH /api/campaigns/[id]/owner', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(assignOwner).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(assignOwner).not.toHaveBeenCalled()
  })

  it('200 for an admin, assigning the given owner', async () => {
    const res = await call({ ownerId: 'm-2' })
    expect(res.status).toBe(200)
    expect(assignOwner).toHaveBeenCalledWith('org-1', 'campaign', 'camp-1', 'm-2')
  })

  it('200 for an admin, unassigning with ownerId: null', async () => {
    const res = await call({ ownerId: null })
    expect(res.status).toBe(200)
    expect(assignOwner).toHaveBeenCalledWith('org-1', 'campaign', 'camp-1', null)
  })

  it('404 when the campaign is not in this org', async () => {
    vi.mocked(assignOwner).mockResolvedValue(false)
    const res = await call()
    expect(res.status).toBe(404)
  })

  it('400 when ownerId is not a member of the org', async () => {
    vi.mocked(assignOwner).mockRejectedValue(new InvalidOwnerError())
    const res = await call()
    expect(res.status).toBe(400)
  })

  it('400 for a bad body (invalid JSON)', async () => {
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: '{not json' }), {
      params: Promise.resolve({ id: 'camp-1' }),
    })
    expect(res.status).toBe(400)
    expect(assignOwner).not.toHaveBeenCalled()
  })

  it('400 when ownerId is neither a string nor null', async () => {
    const res = await call({ ownerId: 42 })
    expect(res.status).toBe(400)
    expect(assignOwner).not.toHaveBeenCalled()
  })
})
