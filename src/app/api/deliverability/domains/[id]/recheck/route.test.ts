import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    domainHealth: {
      findFirst: vi.fn(),
    },
  },
}))
vi.mock('@/features/deliverability/server/domain-health', async (orig) => ({
  ...(await orig<typeof import('@/features/deliverability/server/domain-health')>()),
  checkDomain: vi.fn(),
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { prisma } from '@/lib/db/prisma'
import { checkDomain } from '@/features/deliverability/server/domain-health'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const ctx = { params: Promise.resolve({ id: 'dh-1' }) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
})
afterEach(() => vi.useRealTimers())

describe('POST /api/deliverability/domains/[id]/recheck', () => {
  it('403 without an org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await POST(new Request('http://x', { method: 'POST' }), ctx)).status).toBe(403)
  })

  it('403 ADMIN_ONLY for a non-admin member, and does not recheck', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    const res = await POST(new Request('http://x', { method: 'POST' }), ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(checkDomain).not.toHaveBeenCalled()
  })

  it("404 for other org's domain", async () => {
    ;(prisma.domainHealth.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await POST(new Request('http://x', { method: 'POST' }), ctx)
    expect(res.status).toBe(404)
    expect(prisma.domainHealth.findFirst).toHaveBeenCalledWith({
      where: { id: 'dh-1', organizationId: 'org-1' },
    })
  })

  it('429 if checked within the last 60s', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-24T12:00:00Z')
    vi.setSystemTime(now)

    ;(prisma.domainHealth.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'dh-1',
      lastAttemptAt: new Date(now.getTime() - 10_000), // 10 seconds ago
    })

    const res = await POST(new Request('http://x', { method: 'POST' }), ctx)
    expect(res.status).toBe(429)
    const data = await res.json()
    expect(data.retryAfterSeconds).toBeGreaterThanOrEqual(49)
    expect(data.retryAfterSeconds).toBeLessThanOrEqual(50)
    expect(checkDomain).not.toHaveBeenCalled()
  })

  it('rechecks if 2 min ago, returning status', async () => {
    vi.useFakeTimers()
    const now = new Date('2026-09-24T12:00:00Z')
    vi.setSystemTime(now)

    ;(prisma.domainHealth.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'dh-1',
      lastAttemptAt: new Date(now.getTime() - 120_000), // 2 minutes ago
    })
    ;(checkDomain as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'HEALTHY',
      lastError: null,
    })

    const res = await POST(new Request('http://x', { method: 'POST' }), ctx)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'HEALTHY', lastError: null })
    expect(checkDomain).toHaveBeenCalledWith('dh-1')
  })

  it('500 if checkDomain rejects', async () => {
    ;(prisma.domainHealth.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'dh-1',
      lastAttemptAt: null,
    })
    ;(checkDomain as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const res = await POST(new Request('http://x', { method: 'POST' }), ctx)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(consoleErrorSpy).toHaveBeenCalledWith('[POST /api/deliverability/domains/[id]/recheck]', expect.any(Error))

    consoleErrorSpy.mockRestore()
  })
})
