import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { orgMember: { findFirst: vi.fn() } } }))
vi.mock('@/features/team/server/team-settings', async () => {
  const actual = await vi.importActual<typeof import('@/features/team/server/team-settings')>(
    '@/features/team/server/team-settings',
  )
  return { ...actual, updateMember: vi.fn() }
})

import { resolveMember } from '@/lib/auth/resolve-member'
import { prisma } from '@/lib/db/prisma'
import { updateMember, TeamValidationError } from '@/features/team/server/team-settings'
import { PATCH } from './route'

const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }
const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }

function call(id: string, body: unknown = { senderFirstName: 'Al' }) {
  return PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
  vi.mocked(prisma.orgMember.findFirst as never).mockResolvedValue({ id: 'm-target' })
  vi.mocked(updateMember).mockResolvedValue(true)
})

describe('PATCH /api/team/members/[id]', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call('m-target')).status).toBe(401)
    expect(updateMember).not.toHaveBeenCalled()
  })

  it('200 for an admin editing anyone', async () => {
    const res = await call('m-target')
    expect(res.status).toBe(200)
    expect(updateMember).toHaveBeenCalledWith('org-1', 'm-target', { senderFirstName: 'Al' })
  })

  it('200 for a member editing themselves', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    vi.mocked(prisma.orgMember.findFirst as never).mockResolvedValue({ id: 'm-rep' })
    const res = await call('m-rep')
    expect(res.status).toBe(200)
    expect(updateMember).toHaveBeenCalledWith('org-1', 'm-rep', { senderFirstName: 'Al' })
  })

  it('403 NOT_OWNER for a member editing someone else', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    vi.mocked(prisma.orgMember.findFirst as never).mockResolvedValue({ id: 'm-other' })
    const res = await call('m-other')
    const data = await res.json()
    expect(res.status).toBe(403)
    expect(data.code).toBe('NOT_OWNER')
    expect(data.error).toBe('You can only change your own settings.')
    expect(updateMember).not.toHaveBeenCalled()
  })

  it('404 for an unknown member (admin)', async () => {
    vi.mocked(prisma.orgMember.findFirst as never).mockResolvedValue(null)
    const res = await call('m-ghost')
    expect(res.status).toBe(404)
    expect(updateMember).not.toHaveBeenCalled()
  })

  it('404 for an unknown member (rep editing a nonexistent id, including their own if deleted)', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    vi.mocked(prisma.orgMember.findFirst as never).mockResolvedValue(null)
    const res = await call('m-ghost')
    expect(res.status).toBe(404)
    expect(updateMember).not.toHaveBeenCalled()
  })

  it('400 on validation error from updateMember', async () => {
    vi.mocked(updateMember).mockRejectedValue(new TeamValidationError('Invalid escalation email'))
    const res = await call('m-target', { escalationEmail: 'nope' })
    expect(res.status).toBe(400)
  })

  it('400 for a bad body (invalid JSON)', async () => {
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: '{not json' }), {
      params: Promise.resolve({ id: 'm-target' }),
    })
    expect(res.status).toBe(400)
    expect(updateMember).not.toHaveBeenCalled()
  })

  it('400 when a field is neither a string nor null', async () => {
    const res = await call('m-target', { senderFirstName: 42 })
    expect(res.status).toBe(400)
    expect(updateMember).not.toHaveBeenCalled()
  })

  it('404 when updateMember reports the row was not found (race)', async () => {
    vi.mocked(updateMember).mockResolvedValue(false)
    const res = await call('m-target')
    expect(res.status).toBe(404)
  })
})
