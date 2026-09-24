import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cron', () => ({ isAuthorizedCron: vi.fn(), recordHeartbeat: vi.fn(), getAuthPausedOrgIds: vi.fn() }))
vi.mock('@/features/inbox/server/monitor-mailboxes', () => ({ monitorMailboxes: vi.fn() }))

import { isAuthorizedCron, recordHeartbeat, getAuthPausedOrgIds } from '@/lib/cron'
import { monitorMailboxes } from '@/features/inbox/server/monitor-mailboxes'
import { GET } from './route'

beforeEach(() => {
  vi.resetAllMocks()
  ;(getAuthPausedOrgIds as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

const ok = {
  mailboxes: 3, replies: 1, unmatched: 0, bounces: 0, autoReplies: 0, handled: 0, notified: 1,
  errors: 0, failedMailboxes: [] as string[],
}

describe('GET /api/cron/inbox-monitor', () => {
  it('401 without the cron secret', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(false)
    expect((await GET(new Request('http://x'))).status).toBe(401)
    expect(monitorMailboxes).not.toHaveBeenCalled()
  })
  it('runs the monitor and records a heartbeat', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const result = {
      mailboxes: 3, replies: 1, unmatched: 0, bounces: 0, autoReplies: 0, handled: 0, notified: 1,
      errors: 0, failedMailboxes: [],
    }
    ;(monitorMailboxes as ReturnType<typeof vi.fn>).mockResolvedValue(result)
    const res = await GET(new Request('http://x'))
    expect(await res.json()).toEqual(result)
    expect(recordHeartbeat).toHaveBeenCalledWith('inbox-monitor', result)
  })
  it('still records a heartbeat and returns 500 when monitorMailboxes throws', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(monitorMailboxes as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))
    const res = await GET(new Request('http://x'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
    expect(recordHeartbeat).toHaveBeenCalledWith('inbox-monitor', { error: 'boom' })
  })
  it('returns 503 when mailboxes failed to poll (I4)', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const result = { ...ok, errors: 1, failedMailboxes: ['mike@getacmesnow.com'] }
    ;(monitorMailboxes as ReturnType<typeof vi.fn>).mockResolvedValue(result)
    const res = await GET(new Request('http://x'))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ errors: 1, failedMailboxes: ['mike@getacmesnow.com'] })
    expect(recordHeartbeat).toHaveBeenCalledWith('inbox-monitor', result)
  })
  it('returns 503 when an org is paused by a Microsoft 365 auth failure (I4)', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(monitorMailboxes as ReturnType<typeof vi.fn>).mockResolvedValue(ok)
    ;(getAuthPausedOrgIds as ReturnType<typeof vi.fn>).mockResolvedValue(['org-1'])
    const res = await GET(new Request('http://x'))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ authPaused: ['org-1'] })
    expect(recordHeartbeat).toHaveBeenCalledWith('inbox-monitor', ok)
  })
})
