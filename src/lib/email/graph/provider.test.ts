import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./mail', () => ({
  createDraftMessage: vi.fn(),
  createReplyDraft: vi.fn(),
  sendDraftMessage: vi.fn(),
}))

import { createDraftMessage, createReplyDraft, sendDraftMessage } from './mail'
import { GraphEmailProvider } from './provider'
import { buildComplianceFooter } from '../compliance'

const create = createDraftMessage as ReturnType<typeof vi.fn>
const reply = createReplyDraft as ReturnType<typeof vi.fn>
const send = sendDraftMessage as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
  create.mockResolvedValue({ id: 'd1', conversationId: 'c1' })
  reply.mockResolvedValue({ id: 'r1', conversationId: 'c1' })
  send.mockResolvedValue(undefined)
})

const input = { to: 'jane@a.com', fromEmail: 'mike@x.com', fromName: 'Mike', subject: 'S', body: 'Hello' }

describe('GraphEmailProvider', () => {
  it('first send: creates a draft, calls onPrepared with its id BEFORE sending, returns ids', async () => {
    const order: string[] = []
    send.mockImplementation(async () => { order.push('send') })
    const onPrepared = vi.fn(async (id: string) => { order.push(`prepared:${id}`) })
    const out = await new GraphEmailProvider('t').sendEmail({ ...input, onPrepared })
    expect(order).toEqual(['prepared:d1', 'send'])
    expect(create).toHaveBeenCalledWith('t', 'mike@x.com', { to: 'jane@a.com', subject: 'S', text: 'Hello' })
    expect(out).toEqual({ sgMessageId: null, providerMessageId: 'd1', conversationId: 'c1' })
  })

  it('follow-up: uses createReply on the prior message', async () => {
    await new GraphEmailProvider('t').sendEmail({ ...input, subject: 'Re: S', replyToProviderMessageId: 'prior-1' })
    expect(reply).toHaveBeenCalledWith('t', 'mike@x.com', 'prior-1', { to: 'jane@a.com', subject: 'Re: S', text: 'Hello' })
    expect(create).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('t', 'mike@x.com', 'r1')
  })

  it('appends the unsubscribe link to the body', async () => {
    await new GraphEmailProvider('t').sendEmail({ ...input, listUnsubscribe: { url: 'https://app/u?token=abc' } })
    expect(create.mock.calls[0][2].text).toBe(buildComplianceFooter('Hello', undefined, { url: 'https://app/u?token=abc' }))
    expect(create.mock.calls[0][2].text).toContain('https://app/u?token=abc')
  })

  it('renders the CAN-SPAM sender block and unsubscribe link in the body', async () => {
    await new GraphEmailProvider('t').sendEmail({
      ...input,
      sender: { businessName: 'Acme Snow', postalAddress: '1 Main St, Buffalo, NY' },
      listUnsubscribe: { url: 'https://app/u?token=abc' },
    })
    const text = create.mock.calls[0][2].text as string
    expect(text).toContain('Acme Snow\n1 Main St, Buffalo, NY')
    expect(text).toContain('https://app/u?token=abc')
  })

  it('does not send when onPrepared throws (id could not be persisted)', async () => {
    await expect(
      new GraphEmailProvider('t').sendEmail({ ...input, onPrepared: async () => { throw new Error('db down') } }),
    ).rejects.toThrow('db down')
    expect(send).not.toHaveBeenCalled()
  })
})
