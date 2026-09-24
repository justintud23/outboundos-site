import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cron', () => ({ isAuthorizedCron: vi.fn(), recordHeartbeat: vi.fn() }))
vi.mock('@/features/inbox/server/monitor-mailboxes', () => ({ monitorMailboxes: vi.fn() }))

import { isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
import { monitorMailboxes } from '@/features/inbox/server/monitor-mailboxes'
import { GET } from './route'

beforeEach(() => vi.resetAllMocks())

describe('GET /api/cron/inbox-monitor', () => {
  it('401 without the cron secret', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(false)
    expect((await GET(new Request('http://x'))).status).toBe(401)
    expect(monitorMailboxes).not.toHaveBeenCalled()
  })
  it('runs the monitor and records a heartbeat', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(true)
    const result = { mailboxes: 3, replies: 1, unmatched: 0, bounces: 0, autoReplies: 0, handled: 0, notified: 1 }
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
})
