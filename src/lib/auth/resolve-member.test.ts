import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn(), clerkClient: vi.fn() }))
vi.mock('./resolve-organization', () => ({ resolveOrganization: vi.fn(async () => ({ id: 'org-1', clerkId: 'clerk-org' })) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { orgMember: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } } }))

import { auth, clerkClient } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { resolveMember } from './resolve-member'

type Fn = ReturnType<typeof vi.fn>
const om = (prisma as unknown as { orgMember: Record<string, Fn> }).orgMember
const getUser = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(clerkClient).mockResolvedValue({ users: { getUser } } as never)
  om.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'm1', clerkUserId: 'user_1', organizationId: 'org-1', role: 'admin', senderFirstName: null, senderLastName: null, lastSeenAt: new Date(), ...data }))
})

describe('resolveMember', () => {
  it('returns null without an org or user', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: null, userId: 'u' } as never)
    expect(await resolveMember()).toBeNull()
  })

  it('creates a member on first sight, maps org:admin → admin, and fills name/email/sender names from Clerk', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1', orgRole: 'org:admin' } as never)
    om.findUnique.mockResolvedValue(null)
    om.create.mockResolvedValue({ id: 'm1', clerkUserId: 'user_1', organizationId: 'org-1', role: 'admin', senderFirstName: null, senderLastName: null, lastSeenAt: null })
    getUser.mockResolvedValue({ firstName: 'Justin', lastName: 'T', username: null, primaryEmailAddress: { emailAddress: 'justin@acme.com' }, emailAddresses: [] })
    const ctx = await resolveMember()
    expect(om.create).toHaveBeenCalledWith({ data: { clerkUserId: 'user_1', organizationId: 'org-1', role: 'admin' } })
    expect(ctx!.isAdmin).toBe(true)
    expect(om.update.mock.calls[0]![0].data).toMatchObject({ name: 'Justin T', email: 'justin@acme.com', senderFirstName: 'Justin', senderLastName: 'T', lastSeenAt: expect.any(Date) })
  })

  it('updates the role when Clerk changed it, and skips Clerk within the hour', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1', orgRole: 'org:member' } as never)
    om.findUnique.mockResolvedValue({ id: 'm1', role: 'admin', lastSeenAt: new Date(), senderFirstName: 'J', senderLastName: null })
    const ctx = await resolveMember()
    expect(om.update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { role: 'member' } })
    expect(getUser).not.toHaveBeenCalled()
    expect(ctx!.isAdmin).toBe(false)
  })

  it('does not overwrite sender names the rep already set, and tolerates a Clerk failure', async () => {
    vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org', userId: 'user_1', orgRole: 'org:member' } as never)
    om.findUnique.mockResolvedValue({ id: 'm1', role: 'member', lastSeenAt: new Date(Date.now() - 2 * 3600_000), senderFirstName: 'Mike', senderLastName: 'R' })
    getUser.mockRejectedValue(new Error('clerk down'))
    const ctx = await resolveMember()
    expect(ctx).not.toBeNull()
    const data = om.update.mock.calls.at(-1)![0].data
    expect(data).toEqual({ lastSeenAt: expect.any(Date) })
  })
})
