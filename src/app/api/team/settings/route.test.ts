import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/team-settings', () => ({ updateTeamSettings: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { updateTeamSettings } from '@/features/team/server/team-settings'
import { PATCH } from './route'

const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }
const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }

function call(body: unknown = { copyAdminOnReplies: false }) {
  return PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }))
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
  vi.mocked(updateTeamSettings).mockResolvedValue(undefined)
})

describe('PATCH /api/team/settings', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    expect(updateTeamSettings).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(updateTeamSettings).not.toHaveBeenCalled()
  })

  it('200 for an admin toggling copyAdminOnReplies', async () => {
    const res = await call({ copyAdminOnReplies: false })
    expect(res.status).toBe(200)
    expect(updateTeamSettings).toHaveBeenCalledWith('org-1', { copyAdminOnReplies: false })
  })

  it('200 for an admin dismissing the banner', async () => {
    const res = await call({ dismissOwnershipBanner: true })
    expect(res.status).toBe(200)
    expect(updateTeamSettings).toHaveBeenCalledWith('org-1', { dismissOwnershipBanner: true })
  })

  it('400 for a bad body (invalid JSON)', async () => {
    const res = await PATCH(new Request('http://x', { method: 'PATCH', body: '{not json' }))
    expect(res.status).toBe(400)
    expect(updateTeamSettings).not.toHaveBeenCalled()
  })

  it('400 when copyAdminOnReplies is not a boolean', async () => {
    const res = await call({ copyAdminOnReplies: 'yes' })
    expect(res.status).toBe(400)
    expect(updateTeamSettings).not.toHaveBeenCalled()
  })

  it('400 when dismissOwnershipBanner is not true', async () => {
    const res = await call({ dismissOwnershipBanner: false })
    expect(res.status).toBe(400)
    expect(updateTeamSettings).not.toHaveBeenCalled()
  })
})
