import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { cronHeartbeat: { upsert: vi.fn(), findMany: vi.fn() }, organization: { findMany: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { isAuthorizedCron, recordHeartbeat, getStaleJobs, getAuthPausedOrgIds } from './cron'

type Fn = ReturnType<typeof vi.fn>
const hb = prisma.cronHeartbeat as unknown as { upsert: Fn; findMany: Fn }

beforeEach(() => { vi.resetAllMocks(); process.env.CRON_SECRET = 's3cret' })
afterEach(() => { delete process.env.CRON_SECRET })

describe('cron helpers', () => {
  it('authorizes only the exact bearer secret, and never when unset', () => {
    const req = (h?: string) => new Request('http://x', { headers: h ? { authorization: h } : {} })
    expect(isAuthorizedCron(req('Bearer s3cret'))).toBe(true)
    expect(isAuthorizedCron(req('Bearer nope'))).toBe(false)
    expect(isAuthorizedCron(req())).toBe(false)
    delete process.env.CRON_SECRET
    expect(isAuthorizedCron(req('Bearer undefined'))).toBe(false)
  })
  it('upserts a heartbeat', async () => {
    await recordHeartbeat('send-queue', { sent: 1 })
    expect(hb.upsert).toHaveBeenCalledWith({
      where: { job: 'send-queue' },
      create: { job: 'send-queue', lastRunAt: expect.any(Date), lastResult: { sent: 1 } },
      update: { lastRunAt: expect.any(Date), lastResult: { sent: 1 } },
    })
  })
  it('reports missing and >30-minute-old jobs as stale', async () => {
    const now = new Date('2026-09-23T15:00:00Z')
    hb.findMany.mockResolvedValue([
      { job: 'send-queue', lastRunAt: new Date('2026-09-23T14:55:00Z') },
      { job: 'inbox-monitor', lastRunAt: new Date('2026-09-23T14:00:00Z') },
    ])
    expect(await getStaleJobs(now)).toEqual(['sequence-runner', 'inbox-monitor'])
  })
  it('lists orgs auto-paused by a Microsoft 365 auth failure (not manual pauses)', async () => {
    const orgFindMany = (prisma as unknown as { organization: { findMany: Fn } }).organization.findMany
    orgFindMany.mockResolvedValue([{ id: 'org-1' }])
    expect(await getAuthPausedOrgIds()).toEqual(['org-1'])
    expect(orgFindMany).toHaveBeenCalledWith({
      where: { msTenantId: { not: null }, sendingPaused: true, pausedReason: { startsWith: 'Microsoft 365' } },
      select: { id: true },
    })
  })
})
