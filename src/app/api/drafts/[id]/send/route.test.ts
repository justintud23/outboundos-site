import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({ auth: vi.fn() }))
vi.mock('@/lib/auth/resolve-organization', () => ({ resolveOrganization: vi.fn() }))
vi.mock('@/features/messages/server/send-draft', () => ({ sendDraft: vi.fn() }))

import { auth } from '@clerk/nextjs/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { sendDraft } from '@/features/messages/server/send-draft'
import { DraftOnSendQueueError, DomainNotHealthyError } from '@/features/messages/types'
import { POST } from './route'

type Fn = ReturnType<typeof vi.fn>
const call = () => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: 'draft-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  ;(auth as unknown as Fn).mockResolvedValue({ orgId: 'clerk-org', userId: 'user-1' })
  ;(resolveOrganization as Fn).mockResolvedValue({ id: 'org-1' })
})

describe('POST /api/drafts/[id]/send', () => {
  it('409 DRAFT_ON_SEND_QUEUE when the draft is queued for automatic sending', async () => {
    ;(sendDraft as Fn).mockRejectedValue(new DraftOnSendQueueError('QUEUED', 'msg-1'))
    const res = await call()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({
      code: 'DRAFT_ON_SEND_QUEUE',
      messageStatus: 'QUEUED',
      messageId: 'msg-1',
      error: 'This draft is queued for automatic sending.',
    })
  })
  it('409 with a "use Retry" message when the queued send FAILED', async () => {
    ;(sendDraft as Fn).mockRejectedValue(new DraftOnSendQueueError('FAILED', 'msg-1'))
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/use Retry/)
  })
  it('422 DOMAIN_NOT_HEALTHY when the sending mailbox is on a blocked domain', async () => {
    ;(sendDraft as Fn).mockRejectedValue(new DomainNotHealthyError('bad.com', 'FAILING'))
    const res = await call()
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'DOMAIN_NOT_HEALTHY', domain: 'bad.com' })
  })
})
