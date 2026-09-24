import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn().mockResolvedValue({ id: 'org-1' }) }))
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

import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { checkDomain } from '@/features/deliverability/server/domain-health'
import { POST } from './route'

const ctx = { params: Promise.resolve({ id: 'dh-1' }) }
beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe('POST /api/deliverability/domains/[id]/recheck', () => {
  it('403 without an org', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: null, userId: null })
    expect((await POST(new Request('http://x', { method: 'POST' }), ctx)).status).toBe(403)
  })

  it("404 for other org's domain", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
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

    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
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

    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
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
})
