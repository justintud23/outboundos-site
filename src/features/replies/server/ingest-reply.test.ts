import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead:            { findUnique: vi.fn() },
    outboundMessage: { findUnique: vi.fn() },
    promptTemplate:  { findFirst: vi.fn() },
    inboundReply:    { create: vi.fn() },
  },
}))

vi.mock('@/lib/ai', () => ({
  getAIProvider: vi.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { ingestReply } from './ingest-reply'
import { LeadNotFoundByEmailError } from '../types'

const mockLeadFindUnique    = prisma.lead.findUnique            as ReturnType<typeof vi.fn>
const mockMsgFindUnique     = prisma.outboundMessage.findUnique as ReturnType<typeof vi.fn>
const mockTemplateFindFirst = prisma.promptTemplate.findFirst   as ReturnType<typeof vi.fn>
const mockReplyCreate       = prisma.inboundReply.create        as ReturnType<typeof vi.fn>
const mockGetAIProvider     = getAIProvider                     as ReturnType<typeof vi.fn>

const baseLead    = { id: 'lead-1' }
const baseMessage = { id: 'msg-1' }
const baseReply   = {
  id: 'reply-1',
  organizationId: 'org-1',
  leadId: 'lead-1',
  outboundMessageId: 'msg-1',
  rawBody: 'Sounds great!',
  classification: 'POSITIVE' as const,
  classificationConfidence: 0.92,
  receivedAt: new Date(),
  createdAt: new Date(),
}

function mockProvider(classification = 'POSITIVE', confidence = 0.92) {
  mockGetAIProvider.mockReturnValue({
    classifyReply: vi.fn().mockResolvedValue({ classification, confidence }),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTemplateFindFirst.mockResolvedValue(null) // use fallback prompt by default
})

describe('ingestReply', () => {
  it('creates an InboundReply with classification and outboundMessage link', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockMsgFindUnique.mockResolvedValue(baseMessage)
    mockProvider('POSITIVE', 0.92)
    mockReplyCreate.mockResolvedValue(baseReply)

    const result = await ingestReply({
      organizationId: 'org-1',
      fromEmail: 'lead@acme.com',
      rawBody: 'Sounds great!',
      inReplyToSgMessageId: 'sg-msg-abc',
    })

    expect(mockLeadFindUnique).toHaveBeenCalledWith({
      where: { organizationId_email: { organizationId: 'org-1', email: 'lead@acme.com' } },
      select: { id: true },
    })
    expect(mockMsgFindUnique).toHaveBeenCalledWith({
      where: { sgMessageId: 'sg-msg-abc' },
      select: { id: true },
    })
    expect(mockReplyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        leadId: 'lead-1',
        outboundMessageId: 'msg-1',
        rawBody: 'Sounds great!',
        classification: 'POSITIVE',
        classificationConfidence: 0.92,
      }),
    })
    expect(result.id).toBe('reply-1')
  })

  it('throws LeadNotFoundByEmailError when lead does not exist', async () => {
    mockLeadFindUnique.mockResolvedValue(null)
    mockProvider()

    await expect(
      ingestReply({ organizationId: 'org-1', fromEmail: 'unknown@example.com', rawBody: 'hi' }),
    ).rejects.toThrow(LeadNotFoundByEmailError)
  })

  it('sets outboundMessageId to null when inReplyToSgMessageId is not provided', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockProvider('NEUTRAL', 0.7)
    mockReplyCreate.mockResolvedValue({ ...baseReply, outboundMessageId: null, classification: 'NEUTRAL', classificationConfidence: 0.7 })

    await ingestReply({ organizationId: 'org-1', fromEmail: 'lead@acme.com', rawBody: 'Thanks' })

    expect(mockMsgFindUnique).not.toHaveBeenCalled()
    expect(mockReplyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ outboundMessageId: null }),
    })
  })

  it('sets outboundMessageId to null when sgMessageId does not match any message', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockMsgFindUnique.mockResolvedValue(null)
    mockProvider('NEGATIVE', 0.88)
    mockReplyCreate.mockResolvedValue({ ...baseReply, outboundMessageId: null })

    await ingestReply({
      organizationId: 'org-1',
      fromEmail: 'lead@acme.com',
      rawBody: 'Not interested',
      inReplyToSgMessageId: 'sg-unknown',
    })

    expect(mockReplyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ outboundMessageId: null }),
    })
  })

  it('uses custom prompt template when one is active', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockTemplateFindFirst.mockResolvedValue({ body: 'custom classify prompt' })
    const mockClassify = vi.fn().mockResolvedValue({ classification: 'POSITIVE', confidence: 0.8 })
    mockGetAIProvider.mockReturnValue({ classifyReply: mockClassify })
    mockReplyCreate.mockResolvedValue(baseReply)

    await ingestReply({ organizationId: 'org-1', fromEmail: 'lead@acme.com', rawBody: 'Yes!' })

    expect(mockTemplateFindFirst).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', promptType: 'REPLY_CLASSIFICATION', isActive: true },
    })
    expect(mockClassify).toHaveBeenCalledWith({ rawBody: 'Yes!' }, 'custom classify prompt')
  })

  it('uses fallback prompt when no template is active', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockTemplateFindFirst.mockResolvedValue(null)
    const mockClassify = vi.fn().mockResolvedValue({ classification: 'UNKNOWN', confidence: 0 })
    mockGetAIProvider.mockReturnValue({ classifyReply: mockClassify })
    mockReplyCreate.mockResolvedValue({ ...baseReply, classification: 'UNKNOWN', classificationConfidence: 0 })

    await ingestReply({ organizationId: 'org-1', fromEmail: 'lead@acme.com', rawBody: '???' })

    const [, promptUsed] = mockClassify.mock.calls[0] as [unknown, string]
    expect(promptUsed).toContain('POSITIVE')
    expect(promptUsed).toContain('UNSUBSCRIBE_REQUEST')
  })

  it('throws when rawBody exceeds 50000 characters', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)

    await expect(
      ingestReply({
        organizationId: 'org-1',
        fromEmail: 'lead@acme.com',
        rawBody: 'x'.repeat(50_001),
      }),
    ).rejects.toThrow('Reply body exceeds maximum allowed length')
  })

  it('stores receivedAt when provided', async () => {
    mockLeadFindUnique.mockResolvedValue(baseLead)
    mockProvider('OUT_OF_OFFICE', 0.99)
    const customDate = new Date('2026-01-15T10:00:00Z')
    mockReplyCreate.mockResolvedValue({ ...baseReply, receivedAt: customDate })

    await ingestReply({
      organizationId: 'org-1',
      fromEmail: 'lead@acme.com',
      rawBody: 'OOO until Jan 20',
      receivedAt: customDate,
    })

    expect(mockReplyCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ receivedAt: customDate }),
    })
  })
})
