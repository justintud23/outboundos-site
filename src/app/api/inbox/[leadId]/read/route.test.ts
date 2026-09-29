import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn() }))
vi.mock('@/features/inbox/server/mark-thread-read', () => ({ markThreadRead: vi.fn() }))

import { auth } from '@clerk/nextjs/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { markThreadRead } from '@/features/inbox/server/mark-thread-read'
import { PATCH } from './route'

const call = (body: unknown = { isRead: true }) =>
  PATCH(new Request('http://x', { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ leadId: 'lead-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(auth).mockResolvedValue({ orgId: 'clerk-org' } as never)
  vi.mocked(resolveOrganization).mockResolvedValue({ id: 'org-1' } as never)
  vi.mocked(markThreadRead).mockResolvedValue({ updated: 1 } as never)
})

describe('PATCH /api/inbox/[leadId]/read', () => {
  // This route is any-member (not owner- or admin-gated) — a non-admin
  // member marking a thread read must still succeed.
  it('a non-admin member can still mark a thread read', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ updated: 1 })
    expect(markThreadRead).toHaveBeenCalledWith({ organizationId: 'org-1', leadId: 'lead-1', isRead: true })
  })
})
