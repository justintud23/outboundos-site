import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))

vi.mock('@/features/integrations/server/microsoft', () => ({
  importGraphMailboxes: vi.fn(),
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { importGraphMailboxes } from '@/features/integrations/server/microsoft'
import { POST } from './route'

const mockResolveMember = resolveMember as unknown as ReturnType<typeof vi.fn>
const mockImportGraphMailboxes = importGraphMailboxes as unknown as ReturnType<typeof vi.fn>

const connectedOrg = { id: 'internal-org-id', clerkId: 'clerk-org-id', msTenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47' }
const rep = { org: connectedOrg, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: connectedOrg, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

function makeRequest(body: unknown): Request {
  return new Request('https://app.test/api/integrations/microsoft/mailboxes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const validUser = { id: 'u1', email: 'mike@acme.com', displayName: 'Mike' }

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveMember.mockResolvedValue(admin as never)
})

describe('POST /api/integrations/microsoft/mailboxes', () => {
  it('403 without an active org', async () => {
    mockResolveMember.mockResolvedValue(null)
    const res = await POST(makeRequest({ users: [validUser] }))
    expect(res.status).toBe(403)
    expect(mockImportGraphMailboxes).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member, and does not import', async () => {
    mockResolveMember.mockResolvedValue(rep as never)
    const res = await POST(makeRequest({ users: [validUser] }))
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(mockImportGraphMailboxes).not.toHaveBeenCalled()
  })

  it('returns 400 for an empty users array', async () => {
    const res = await POST(makeRequest({ users: [] }))

    expect(res.status).toBe(400)
    expect(mockImportGraphMailboxes).not.toHaveBeenCalled()
  })

  it('returns 400 when users exceeds 50', async () => {
    const users = Array.from({ length: 51 }, (_, i) => ({ id: `u${i}`, email: `u${i}@acme.com`, displayName: `U${i}` }))
    const res = await POST(makeRequest({ users }))

    expect(res.status).toBe(400)
    expect(mockImportGraphMailboxes).not.toHaveBeenCalled()
  })

  it('returns 400 for bad shapes', async () => {
    const res = await POST(makeRequest({ users: [{ id: 'u1', email: 'mike@acme.com' }] }))

    expect(res.status).toBe(400)
    expect(mockImportGraphMailboxes).not.toHaveBeenCalled()
  })

  it('returns 400 when users is missing entirely', async () => {
    const res = await POST(makeRequest({}))

    expect(res.status).toBe(400)
    expect(mockImportGraphMailboxes).not.toHaveBeenCalled()
  })

  it('returns 201 with { created } on success for an admin', async () => {
    mockImportGraphMailboxes.mockResolvedValue({ created: 1 })

    const res = await POST(makeRequest({ users: [validUser] }))

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ created: 1 })
    expect(mockImportGraphMailboxes).toHaveBeenCalledWith('internal-org-id', [validUser])
  })

  it('returns 409 when Microsoft 365 is not connected', async () => {
    mockResolveMember.mockResolvedValue({ ...admin, org: { ...connectedOrg, msTenantId: null } } as never)

    const res = await POST(makeRequest({ users: [validUser] }))

    expect(res.status).toBe(409)
    expect(mockImportGraphMailboxes).not.toHaveBeenCalled()
  })
})
