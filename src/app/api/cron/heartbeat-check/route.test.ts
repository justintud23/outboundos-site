import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cron', () => ({ isAuthorizedCron: vi.fn(), getStaleJobs: vi.fn(), getAuthPausedOrgIds: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findMany: vi.fn() } } }))
vi.mock('@/features/replies/server/notify', () => ({ sendOrgAlert: vi.fn() }))
vi.mock('@/features/deliverability/server/domain-health', () => ({ refreshAllDomains: vi.fn() }))

import { isAuthorizedCron, getStaleJobs, getAuthPausedOrgIds } from '@/lib/cron'
import { prisma } from '@/lib/db/prisma'
import { sendOrgAlert } from '@/features/replies/server/notify'
import { refreshAllDomains } from '@/features/deliverability/server/domain-health'
import { GET } from './route'

type Fn = ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.resetAllMocks()
  ;(isAuthorizedCron as Fn).mockReturnValue(true)
  ;(sendOrgAlert as Fn).mockResolvedValue(true)
  ;(getAuthPausedOrgIds as Fn).mockResolvedValue([])
  ;(refreshAllDomains as Fn).mockResolvedValue({ checked: 1, failed: 0 })
})

describe('GET /api/cron/heartbeat-check', () => {
  it('401 without the secret', async () => {
    ;(isAuthorizedCron as Fn).mockReturnValue(false)
    expect((await GET(new Request('http://x'))).status).toBe(401)
  })
  it('alerts every org with an escalation address when jobs are stale', async () => {
    ;(getStaleJobs as Fn).mockResolvedValue(['send-queue'])
    ;(prisma.organization.findMany as Fn).mockResolvedValue([{ id: 'org-1' }, { id: 'org-2' }])
    const res = await GET(new Request('http://x'))
    expect(await res.json()).toEqual({ stale: ['send-queue'], alerted: 2, authPaused: [], domains: { checked: 1, failed: 0 } })
    expect(sendOrgAlert).toHaveBeenCalledWith('org-1', 'Scheduler has stopped', expect.stringContaining('send-queue'))
  })
  it('does nothing when all jobs are fresh', async () => {
    ;(getStaleJobs as Fn).mockResolvedValue([])
    const res = await GET(new Request('http://x'))
    expect(await res.json()).toEqual({ stale: [], alerted: 0, authPaused: [], domains: { checked: 1, failed: 0 } })
    expect(sendOrgAlert).not.toHaveBeenCalled()
  })
  it('reports orgs paused by a Microsoft 365 auth failure (I4)', async () => {
    ;(getStaleJobs as Fn).mockResolvedValue([])
    ;(getAuthPausedOrgIds as Fn).mockResolvedValue(['org-1'])
    const res = await GET(new Request('http://x'))
    expect(await res.json()).toEqual({ stale: [], alerted: 0, authPaused: ['org-1'], domains: { checked: 1, failed: 0 } })
  })
  it('refreshes domain health even when no jobs are stale, and survives a refresh failure', async () => {
    ;(getStaleJobs as Fn).mockResolvedValue([])
    ;(refreshAllDomains as Fn).mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await GET(new Request('http://x'))
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ domains: { error: 'boom' } })
  })
})
