import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn().mockResolvedValue({ id: 'org-1' }) }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    domainHealth: {
      updateMany: vi.fn(),
    },
  },
}))

import { auth } from '@clerk/nextjs/server'
import { prisma } from '@/lib/db/prisma'
import { PATCH } from './route'

const ctx = { params: Promise.resolve({ id: 'dh-1' }) }
beforeEach(() => vi.clearAllMocks())

describe('PATCH /api/deliverability/domains/[id]', () => {
  it('403 without an org', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: null, userId: null })
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '2026-08-01' }),
    })
    expect((await PATCH(req, ctx)).status).toBe(403)
  })

  it('updates with a valid past date', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    ;(prisma.domainHealth.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })

    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '2026-08-01' }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.registeredAtSource).toBe('manual')
    expect(prisma.domainHealth.updateMany).toHaveBeenCalledWith({
      where: { id: 'dh-1', organizationId: 'org-1' },
      data: {
        registeredAt: new Date('2026-08-01T00:00:00Z'),
        registeredAtSource: 'manual',
      },
    })
  })

  it('400 for invalid date format', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: 'soon' }),
    })
    expect((await PATCH(req, ctx)).status).toBe(400)
  })

  it('400 for future date', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    const futureDate = new Date()
    futureDate.setDate(futureDate.getDate() + 1)
    const futureDateString = futureDate.toISOString().split('T')[0]

    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: futureDateString }),
    })
    expect((await PATCH(req, ctx)).status).toBe(400)
  })

  it('400 for date before 1985', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '1984-12-31' }),
    })
    expect((await PATCH(req, ctx)).status).toBe(400)
  })

  it("404 for other org's domain", async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    ;(prisma.domainHealth.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })

    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '2026-08-01' }),
    })
    expect((await PATCH(req, ctx)).status).toBe(404)
  })

  it('400 for invalid calendar date (Feb 30)', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '2026-02-30' }),
    })
    expect((await PATCH(req, ctx)).status).toBe(400)
  })

  it('500 if updateMany rejects', async () => {
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ orgId: 'clerk-org', userId: 'u1' })
    ;(prisma.domainHealth.updateMany as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Database error'))

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '2026-08-01' }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Internal server error' })
    expect(consoleErrorSpy).toHaveBeenCalledWith('[PATCH /api/deliverability/domains/[id]]', expect.any(Error))

    consoleErrorSpy.mockRestore()
  })
})
