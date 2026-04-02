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
})
