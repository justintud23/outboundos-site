import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@sendgrid/mail', () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn(),
  },
}))

import sgMail from '@sendgrid/mail'
import { SendGridProvider } from './sendgrid'

const mockSgMail = sgMail as unknown as {
  setApiKey: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
}

beforeEach(() => vi.clearAllMocks())

describe('SendGridProvider', () => {
  it('calls setApiKey on construction', () => {
    new SendGridProvider('test-key')
    expect(mockSgMail.setApiKey).toHaveBeenCalledWith('test-key')
  })

  it('sends email and returns sgMessageId from response header', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: { 'x-message-id': 'sg-abc-123' }, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    const result = await provider.sendEmail({
      to: 'lead@acme.com',
      fromEmail: 'sender@company.com',
      fromName: 'Sales Team',
      subject: 'Hello Acme',
      body: 'Hi there...',
    })
    expect(result.sgMessageId).toBe('sg-abc-123')
    expect(mockSgMail.send).toHaveBeenCalledWith({
      to: 'lead@acme.com',
      from: { email: 'sender@company.com', name: 'Sales Team' },
      subject: 'Hello Acme',
      text: 'Hi there...',
    })
  })

  it('returns null sgMessageId when header is absent', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: {}, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    const result = await provider.sendEmail({
      to: 'a@b.com', fromEmail: 'c@d.com', fromName: 'X', subject: 'S', body: 'B',
    })
    expect(result.sgMessageId).toBeNull()
  })

  it('throws when SendGrid returns a non-2xx error', async () => {
    mockSgMail.send.mockRejectedValue(new Error('SendGrid 400 Bad Request'))
    const provider = new SendGridProvider('test-key')
    await expect(
      provider.sendEmail({ to: 'a@b.com', fromEmail: 'c@d.com', fromName: 'X', subject: 'S', body: 'B' }),
    ).rejects.toThrow('SendGrid 400 Bad Request')
  })

  it('forwards customArgs to SendGrid when provided', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: { 'x-message-id': 'sg-abc-123' }, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    await provider.sendEmail({
      to: 'lead@acme.com',
      fromEmail: 'sender@company.com',
      fromName: 'Sales Team',
      subject: 'Hello Acme',
      body: 'Hi there...',
      customArgs: { draftId: 'draft-1', leadId: 'lead-1' },
    })
    expect(mockSgMail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        customArgs: { draftId: 'draft-1', leadId: 'lead-1' },
      }),
    )
  })

  it('omits customArgs from SendGrid payload when not provided', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: {}, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    await provider.sendEmail({
      to: 'a@b.com', fromEmail: 'c@d.com', fromName: 'X', subject: 'S', body: 'B',
    })
    const callArg = mockSgMail.send.mock.calls[0]?.[0] as Record<string, unknown>
    expect(callArg).not.toHaveProperty('customArgs')
  })

  it('forwards RFC 8058 List-Unsubscribe headers when listUnsubscribe is provided', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: { 'x-message-id': 'sg-1' }, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    await provider.sendEmail({
      to: 'lead@acme.com', fromEmail: 'c@d.com', fromName: 'X', subject: 'S', body: 'B',
      listUnsubscribe: { url: 'https://app.test/api/unsubscribe?token=abc123' },
    })
    expect(mockSgMail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: {
          'List-Unsubscribe': '<https://app.test/api/unsubscribe?token=abc123>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    )
  })

  it('includes a mailto target in List-Unsubscribe when provided', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: { 'x-message-id': 'sg-1' }, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    await provider.sendEmail({
      to: 'lead@acme.com', fromEmail: 'c@d.com', fromName: 'X', subject: 'S', body: 'B',
      listUnsubscribe: { url: 'https://app.test/u?token=abc', mailto: 'unsub@company.com' },
    })
    expect(mockSgMail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'List-Unsubscribe': '<https://app.test/u?token=abc>, <mailto:unsub@company.com>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        }),
      }),
    )
  })

  it('omits headers from SendGrid payload when listUnsubscribe is not provided', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: {}, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    await provider.sendEmail({
      to: 'a@b.com', fromEmail: 'c@d.com', fromName: 'X', subject: 'S', body: 'B',
    })
    const callArg = mockSgMail.send.mock.calls[0]?.[0] as Record<string, unknown>
    expect(callArg).not.toHaveProperty('headers')
  })

  it('forwards RFC 5322 threading headers (Message-ID / In-Reply-To / References)', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: { 'x-message-id': 'sg-1' }, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    await provider.sendEmail({
      to: 'a@b.com', fromEmail: 'c@d.com', fromName: 'X', subject: 'Re: S', body: 'B',
      messageId: '<m3@app.test>',
      inReplyTo: '<m2@app.test>',
      references: ['<m1@app.test>', '<m2@app.test>'],
    })
    expect(mockSgMail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Message-ID': '<m3@app.test>',
          'In-Reply-To': '<m2@app.test>',
          'References': '<m1@app.test> <m2@app.test>', // space-separated chain
        }),
      }),
    )
  })

  it('sets only Message-ID (no In-Reply-To/References) for a first send', async () => {
    mockSgMail.send.mockResolvedValue([
      { statusCode: 202, headers: { 'x-message-id': 'sg-1' }, body: '' },
      {},
    ])
    const provider = new SendGridProvider('test-key')
    await provider.sendEmail({
      to: 'a@b.com', fromEmail: 'c@d.com', fromName: 'X', subject: 'S', body: 'B',
      messageId: '<m1@app.test>',
    })
    const callArg = mockSgMail.send.mock.calls[0]?.[0] as { headers?: Record<string, string> }
    expect(callArg.headers?.['Message-ID']).toBe('<m1@app.test>')
    expect(callArg.headers).not.toHaveProperty('In-Reply-To')
    expect(callArg.headers).not.toHaveProperty('References')
  })
})
