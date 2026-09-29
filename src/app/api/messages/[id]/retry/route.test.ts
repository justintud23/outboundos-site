import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getMessageOwnerId: vi.fn() }))
vi.mock('@/features/messages/server/retry-message', () => ({ retryFailedMessage: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getMessageOwnerId } from '@/features/team/server/owners'
import { retryFailedMessage } from '@/features/messages/server/retry-message'
import { MessageNotFoundError, MessageNotFailedError } from '@/features/messages/types'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = () => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: 'msg-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getMessageOwnerId).mockResolvedValue('m-rep')
  vi.mocked(retryFailedMessage).mockResolvedValue({ id: 'msg-1', status: 'QUEUED' } as never)
})

describe('POST /api/messages/[id]/retry', () => {
  it('403 without an org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(403)
    expect(retryFailedMessage).not.toHaveBeenCalled()
  })
  it('requeues the FAILED message for the caller\'s org', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'msg-1', status: 'QUEUED' })
    expect(retryFailedMessage).toHaveBeenCalledWith({ organizationId: 'org-1', messageId: 'msg-1' })
  })
  it('404 when the message is not in this org', async () => {
    vi.mocked(retryFailedMessage).mockRejectedValue(new MessageNotFoundError())
    expect((await call()).status).toBe(404)
  })
  it('409 when the message is not FAILED', async () => {
    vi.mocked(retryFailedMessage).mockRejectedValue(new MessageNotFailedError('SENT'))
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'MESSAGE_NOT_FAILED' })
  })

  it.each([
    ["another rep's message", rep, 'm-other', 403],
    ['an unassigned lead', rep, null, 403],
    ['their own lead', rep, 'm-rep', 200],
    ['any message as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getMessageOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(retryFailedMessage).not.toHaveBeenCalled()
    }
  })
})
