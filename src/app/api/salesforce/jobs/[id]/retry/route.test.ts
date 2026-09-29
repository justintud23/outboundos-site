import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { salesforceSyncJob: { updateMany: vi.fn() } },
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { prisma } from '@/lib/db/prisma'
import { POST } from './route'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { salesforceSyncJob: { updateMany: Fn } }

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (id = 'job-1') => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
  p.salesforceSyncJob.updateMany.mockResolvedValue({ count: 1 })
})

describe('POST /api/salesforce/jobs/[id]/retry', () => {
  it('403 without an org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(403)
    expect(p.salesforceSyncJob.updateMany).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member, and never retries', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    const res = await call()
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(p.salesforceSyncJob.updateMany).not.toHaveBeenCalled()
  })

  it('404 when the job is not found (wrong org or not FAILED)', async () => {
    p.salesforceSyncJob.updateMany.mockResolvedValue({ count: 0 })
    const res = await call('job-1')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Job not found.' })
  })

  it('200 on success, resetting attempts and nextAttemptAt and clearing lastError', async () => {
    const res = await call('job-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(p.salesforceSyncJob.updateMany).toHaveBeenCalledWith({
      where: { id: 'job-1', organizationId: 'org-1', status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: expect.any(Date), lastError: null },
    })
  })

  it('500 when the update rejects', async () => {
    p.salesforceSyncJob.updateMany.mockRejectedValue(new Error('db down'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await call('job-1')
    expect(res.status).toBe(500)
    consoleErrorSpy.mockRestore()
  })
})
