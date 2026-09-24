import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/cron', () => ({ isAuthorizedCron: vi.fn(), recordHeartbeat: vi.fn() }))
vi.mock('@/features/messages/server/process-send-queue', () => ({ processSendQueue: vi.fn() }))

import { isAuthorizedCron, recordHeartbeat } from '@/lib/cron'
import { processSendQueue } from '@/features/messages/server/process-send-queue'
import { GET } from './route'

beforeEach(() => vi.resetAllMocks())

describe('GET /api/cron/send-queue', () => {
  it('401 without the cron secret', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(false)
    expect((await GET(new Request('http://x'))).status).toBe(401)
    expect(processSendQueue).not.toHaveBeenCalled()
  })
  it('runs the queue and records a heartbeat', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(processSendQueue as ReturnType<typeof vi.fn>).mockResolvedValue({ sent: 2, cancelled: 0, deferred: 0, failed: 0, reconciled: 0 })
    const res = await GET(new Request('http://x'))
    expect(await res.json()).toMatchObject({ sent: 2 })
    expect(recordHeartbeat).toHaveBeenCalledWith('send-queue', expect.objectContaining({ sent: 2 }))
  })
  it('still records a heartbeat and returns 500 when processSendQueue throws', async () => {
    ;(isAuthorizedCron as ReturnType<typeof vi.fn>).mockReturnValue(true)
    ;(processSendQueue as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'))
    const res = await GET(new Request('http://x'))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
    expect(recordHeartbeat).toHaveBeenCalledWith('send-queue', { error: 'boom' })
  })
})
