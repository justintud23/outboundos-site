import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}))

vi.mock('@/lib/auth/resolve-organization', () => ({
  resolveOrganization: vi.fn(),
}))

vi.mock('@/features/integrations/server/microsoft', () => ({
  importGraphMailboxes: vi.fn(),
}))

import { auth } from '@clerk/nextjs/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { importGraphMailboxes } from '@/features/integrations/server/microsoft'
import { POST } from './route'

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>
const mockResolveOrganization = resolveOrganization as unknown as ReturnType<typeof vi.fn>
const mockImportGraphMailboxes = importGraphMailboxes as unknown as ReturnType<typeof vi.fn>

const connectedOrg = { id: 'internal-org-id', clerkId: 'clerk-org-id', msTenantId: '72f988bf-86f1-41af-91ab-2d7cd011db47' }

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
  mockAuth.mockResolvedValue({ orgId: 'clerk-org-id' })
  mockResolveOrganization.mockResolvedValue(connectedOrg)
})

describe('POST /api/integrations/microsoft/mailboxes', () => {
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

  it('returns 201 with { created } on success', async () => {
    mockImportGraphMailboxes.mockResolvedValue({ created: 1 })

    const res = await POST(makeRequest({ users: [validUser] }))

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ created: 1 })
    expect(mockImportGraphMailboxes).toHaveBeenCalledWith('internal-org-id', [validUser])
  })

  it('returns 409 when Microsoft 365 is not connected', async () => {
    mockResolveOrganization.mockResolvedValue({ ...connectedOrg, msTenantId: null })

    const res = await POST(makeRequest({ users: [validUser] }))

    expect(res.status).toBe(409)
    expect(mockImportGraphMailboxes).not.toHaveBeenCalled()
  })
})
