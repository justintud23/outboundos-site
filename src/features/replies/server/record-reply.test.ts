import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { promptTemplate: { findFirst: vi.fn() }, inboundReply: { create: vi.fn() } },
}))
vi.mock('@/lib/ai', () => ({ getAIProvider: vi.fn() }))
vi.mock('@/features/leads/server/transition-lead-status', () => ({ transitionLeadStatus: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { getAIProvider } from '@/lib/ai'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { recordReply } from './record-reply'

type Fn = ReturnType<typeof vi.fn>
const classifyReply = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  ;(getAIProvider as Fn).mockReturnValue({ classifyReply })
  classifyReply.mockResolvedValue({ classification: 'POSITIVE', confidence: 0.9 })
  ;(prisma.promptTemplate.findFirst as Fn).mockResolvedValue(null)
  ;(prisma.inboundReply.create as Fn).mockImplementation(async ({ data }: { data: object }) => ({ id: 'r1', ...data }))
})

describe('recordReply', () => {
  it('persists Graph fields and transitions the lead per classification', async () => {
    const reply = await recordReply({
      organizationId: 'org-1', leadId: 'lead-1', outboundMessageId: 'om-1', rawBody: 'Quote us please',
      mailboxId: 'mb-1', graphMessageId: 'gm-1', conversationId: 'conv-1', fromEmail: 'jane@acmepm.com', subject: 'Re: Snow',
    })
    expect(reply.id).toBe('r1')
    expect(prisma.inboundReply.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1', leadId: 'lead-1', outboundMessageId: 'om-1', classification: 'POSITIVE',
        classificationConfidence: 0.9, mailboxId: 'mb-1', graphMessageId: 'gm-1', conversationId: 'conv-1',
        fromEmail: 'jane@acmepm.com', subject: 'Re: Snow',
      }),
    })
    expect(transitionLeadStatus).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-1', newStatus: 'INTERESTED' }))
  })

  it('rejects bodies over 50,000 characters without calling AI', async () => {
    await expect(
      recordReply({ organizationId: 'org-1', leadId: 'lead-1', outboundMessageId: null, rawBody: 'x'.repeat(50_001) }),
    ).rejects.toThrow(/maximum allowed length/)
    expect(classifyReply).not.toHaveBeenCalled()
  })
})
