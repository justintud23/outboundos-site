import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return { ...actual, graphFetch: vi.fn() }
})

import { graphFetch, GraphError } from './client'
import {
  createDraftMessage,
  createReplyDraft,
  sendDraftMessage,
  getMessageState,
  fetchFolderDelta,
  sendMailAsText,
  listTenantUsers,
} from './mail'

const gf = graphFetch as ReturnType<typeof vi.fn>
beforeEach(() => gf.mockReset())

describe('Graph mail operations', () => {
  it('createDraftMessage posts a text message to the mailbox', async () => {
    gf.mockResolvedValueOnce({ id: 'd1', conversationId: 'c1' })
    const out = await createDraftMessage('t', 'mike@x.com', { to: 'jane@a.com', subject: 'S', text: 'B' })
    expect(out).toEqual({ id: 'd1', conversationId: 'c1' })
    expect(gf).toHaveBeenCalledWith('t', '/users/mike%40x.com/messages', {
      method: 'POST',
      body: { subject: 'S', body: { contentType: 'Text', content: 'B' }, toRecipients: [{ emailAddress: { address: 'jane@a.com' } }] },
    })
  })

  it('createReplyDraft calls createReply then PATCHes subject, body and recipient', async () => {
    gf.mockResolvedValueOnce({ id: 'r1', conversationId: 'c1' }).mockResolvedValueOnce({})
    const out = await createReplyDraft('t', 'mike@x.com', 'prior-1', { to: 'jane@a.com', subject: 'Re: S', text: 'B2' })
    expect(out).toEqual({ id: 'r1', conversationId: 'c1' })
    expect(gf.mock.calls[0]).toEqual(['t', '/users/mike%40x.com/messages/prior-1/createReply', { method: 'POST', body: {} }])
    expect(gf.mock.calls[1]).toEqual([
      't',
      '/users/mike%40x.com/messages/r1',
      {
        method: 'PATCH',
        body: { subject: 'Re: S', body: { contentType: 'Text', content: 'B2' }, toRecipients: [{ emailAddress: { address: 'jane@a.com' } }] },
      },
    ])
  })

  it('sendDraftMessage posts /send', async () => {
    gf.mockResolvedValueOnce(undefined)
    await sendDraftMessage('t', 'mike@x.com', 'd1')
    expect(gf).toHaveBeenCalledWith('t', '/users/mike%40x.com/messages/d1/send', { method: 'POST' })
  })

  it('getMessageState maps isDraft and 404', async () => {
    gf.mockResolvedValueOnce({ id: 'd1', isDraft: false, conversationId: 'c1' })
    expect(await getMessageState('t', 'mike@x.com', 'd1')).toEqual({ state: 'SENT', conversationId: 'c1' })
    gf.mockResolvedValueOnce({ id: 'd1', isDraft: true, conversationId: 'c1' })
    expect((await getMessageState('t', 'mike@x.com', 'd1')).state).toBe('DRAFT')
    gf.mockRejectedValueOnce(new GraphError('nope', 404, 'ErrorItemNotFound'))
    expect(await getMessageState('t', 'mike@x.com', 'd1')).toEqual({ state: 'MISSING', conversationId: null })
  })

  it('fetchFolderDelta starts with a receivedDateTime filter and follows nextLink to the deltaLink', async () => {
    gf.mockResolvedValueOnce({ value: [{ id: 'm1' }], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next1' })
      .mockResolvedValueOnce({ value: [{ id: 'm2' }], '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/delta1' })
    const out = await fetchFolderDelta('t', 'mike@x.com', 'inbox', null, new Date('2026-09-22T00:00:00Z'))
    expect(out.messages.map((m) => m.id)).toEqual(['m1', 'm2'])
    expect(out.resumeLink).toBe('https://graph.microsoft.com/v1.0/delta1')
    const firstUrl = gf.mock.calls[0][1] as string
    expect(firstUrl).toContain('/users/mike%40x.com/mailFolders/inbox/messages/delta?')
    expect(decodeURIComponent(firstUrl)).toContain('$filter=receivedDateTime ge 2026-09-22T00:00:00.000Z')
    expect(gf.mock.calls[0][2]).toEqual({ prefer: ['odata.maxpagesize=50', 'outlook.body-content-type="text"'] })
  })

  it('fetchFolderDelta resumes from a stored link and returns the nextLink when pages run out', async () => {
    gf.mockResolvedValueOnce({ value: [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/next2' })
    const out = await fetchFolderDelta('t', 'mike@x.com', 'inbox', 'https://graph.microsoft.com/v1.0/delta1', new Date(), 1)
    expect(gf.mock.calls[0][1]).toBe('https://graph.microsoft.com/v1.0/delta1')
    expect(out.resumeLink).toBe('https://graph.microsoft.com/v1.0/next2')
  })

  it('sendMailAsText uses sendMail without saving to Sent Items', async () => {
    gf.mockResolvedValueOnce(undefined)
    await sendMailAsText('t', 'alerts@x.com', 'boss@work.com', 'Subj', 'Text')
    expect(gf).toHaveBeenCalledWith('t', '/users/alerts%40x.com/sendMail', {
      method: 'POST',
      body: {
        message: { subject: 'Subj', body: { contentType: 'Text', content: 'Text' }, toRecipients: [{ emailAddress: { address: 'boss@work.com' } }] },
        saveToSentItems: false,
      },
    })
  })

  it('listTenantUsers keeps users with a mail address, following pages', async () => {
    gf.mockResolvedValueOnce({
      value: [{ id: 'u1', mail: 'mike@x.com', displayName: 'Mike' }, { id: 'u2', mail: null, displayName: 'Room' }],
      '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users?page=2',
    }).mockResolvedValueOnce({ value: [{ id: 'u3', mail: 'amy@x.com', displayName: 'Amy' }] })
    expect(await listTenantUsers('t')).toEqual([
      { id: 'u1', email: 'mike@x.com', displayName: 'Mike' },
      { id: 'u3', email: 'amy@x.com', displayName: 'Amy' },
    ])
  })
})
