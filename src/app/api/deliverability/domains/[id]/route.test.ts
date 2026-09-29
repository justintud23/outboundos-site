import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    domainHealth: {
      updateMany: vi.fn(),
    },
  },
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { prisma } from '@/lib/db/prisma'
import { PATCH } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const ctx = { params: Promise.resolve({ id: 'dh-1' }) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(admin as never)
})

describe('PATCH /api/deliverability/domains/[id]', () => {
  it('403 without an org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '2026-08-01' }),
    })
    expect((await PATCH(req, ctx)).status).toBe(403)
  })

  it('403 ADMIN_ONLY for a non-admin member, and does not update', async () => {
    vi.mocked(resolveMember).mockResolvedValue(rep as never)
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '2026-08-01' }),
    })
    const res = await PATCH(req, ctx)
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(prisma.domainHealth.updateMany).not.toHaveBeenCalled()
  })

  it('updates with a valid past date, as an admin', async () => {
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
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: 'soon' }),
    })
    expect((await PATCH(req, ctx)).status).toBe(400)
  })

  it('400 for future date', async () => {
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
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '1984-12-31' }),
    })
    expect((await PATCH(req, ctx)).status).toBe(400)
  })

  it("404 for other org's domain", async () => {
    ;(prisma.domainHealth.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })

    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '2026-08-01' }),
    })
    expect((await PATCH(req, ctx)).status).toBe(404)
  })

  it('400 for invalid calendar date (Feb 30)', async () => {
    const req = new Request('http://x', {
      method: 'PATCH',
      body: JSON.stringify({ registeredAt: '2026-02-30' }),
    })
    expect((await PATCH(req, ctx)).status).toBe(400)
  })

  it('500 if updateMany rejects', async () => {
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
