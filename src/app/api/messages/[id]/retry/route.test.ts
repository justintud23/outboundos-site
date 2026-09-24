import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn() }))
vi.mock('@/features/messages/server/retry-message', () => ({ retryFailedMessage: vi.fn() }))

import { auth } from '@clerk/nextjs/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { retryFailedMessage } from '@/features/messages/server/retry-message'
import { MessageNotFoundError, MessageNotFailedError } from '@/features/messages/types'
import { POST } from './route'

type Fn = ReturnType<typeof vi.fn>
const call = () => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: 'msg-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  ;(auth as unknown as Fn).mockResolvedValue({ orgId: 'clerk-org' })
  ;(resolveOrganization as Fn).mockResolvedValue({ id: 'org-1' })
})

describe('POST /api/messages/[id]/retry', () => {
  it('403 without an org', async () => {
    ;(auth as unknown as Fn).mockResolvedValue({ orgId: null })
    expect((await call()).status).toBe(403)
    expect(retryFailedMessage).not.toHaveBeenCalled()
  })
  it('requeues the FAILED message for the caller\'s org', async () => {
    ;(retryFailedMessage as Fn).mockResolvedValue({ id: 'msg-1', status: 'QUEUED' })
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'msg-1', status: 'QUEUED' })
    expect(retryFailedMessage).toHaveBeenCalledWith({ organizationId: 'org-1', messageId: 'msg-1' })
  })
  it('404 when the message is not in this org', async () => {
    ;(retryFailedMessage as Fn).mockRejectedValue(new MessageNotFoundError())
    expect((await call()).status).toBe(404)
  })
  it('409 when the message is not FAILED', async () => {
    ;(retryFailedMessage as Fn).mockRejectedValue(new MessageNotFailedError('SENT'))
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'MESSAGE_NOT_FAILED' })
  })
})
