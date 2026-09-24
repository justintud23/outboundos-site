import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}))

vi.mock('@/lib/auth/resolve-organization', () => ({
  resolveOrganization: vi.fn(),
}))

vi.mock('@/lib/email/graph/mail', () => ({
  listTenantUsers: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: { mailbox: { findMany: vi.fn() } },
}))

import { auth } from '@clerk/nextjs/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { listTenantUsers } from '@/lib/email/graph/mail'
import { prisma } from '@/lib/db/prisma'
import { GraphAuthError } from '@/lib/email/graph/client'
import { GET } from './route'

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>
const mockResolveOrganization = resolveOrganization as unknown as ReturnType<typeof vi.fn>
const mockListTenantUsers = listTenantUsers as unknown as ReturnType<typeof vi.fn>
const mockFindMany = prisma.mailbox.findMany as unknown as ReturnType<typeof vi.fn>

const connectedOrg = { id: 'internal-org-id', clerkId: 'clerk-org-id', msTenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47' }
const disconnectedOrg = { id: 'internal-org-id', clerkId: 'clerk-org-id', msTenantId: null }

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ orgId: 'clerk-org-id' })
  delete process.env.MS_NOTIFY_MAILBOX
})

describe('GET /api/integrations/microsoft/users', () => {
  it('returns 409 when Microsoft 365 is not connected', async () => {
    mockResolveOrganization.mockResolvedValue(disconnectedOrg)

    const res = await GET()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'Microsoft 365 not connected' })
    expect(mockListTenantUsers).not.toHaveBeenCalled()
  })

  it('filters out MS_NOTIFY_MAILBOX and existing mailboxes case-insensitively', async () => {
    process.env.MS_NOTIFY_MAILBOX = 'Notify@Acme.com'
    mockResolveOrganization.mockResolvedValue(connectedOrg)
    mockFindMany.mockResolvedValue([{ email: 'Amy@Acme.com' }])
    mockListTenantUsers.mockResolvedValue([
      { id: 'u1', email: 'mike@acme.com', displayName: 'Mike' },
      { id: 'u2', email: 'amy@ACME.com', displayName: 'Amy' },
      { id: 'u3', email: 'notify@acme.com', displayName: 'Notify' },
    ])

    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 'u1', email: 'mike@acme.com', displayName: 'Mike' }])
    expect(mockListTenantUsers).toHaveBeenCalledWith('72f988bf-86f1-41af-91ab-2d7cd011db47')
  })

  it('returns 502 when listTenantUsers throws (e.g. GraphAuthError)', async () => {
    mockResolveOrganization.mockResolvedValue(connectedOrg)
    mockFindMany.mockResolvedValue([])
    mockListTenantUsers.mockRejectedValue(new GraphAuthError('token failed', 401))

    const res = await GET()

    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'Could not list Microsoft 365 users. Check admin consent.' })
  })
})
