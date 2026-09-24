import { describe, it, expect, vi } from 'vitest'
import { queueApprovedDraft } from './queue-draft'

describe('queueApprovedDraft', () => {
  it('creates a QUEUED message scheduled now with a Message-ID, keeping the variant only if unedited', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'msg-1' })
    const tx = { outboundMessage: { create } } as never
    const at = new Date('2026-09-23T13:00:00Z')
    await queueApprovedDraft(
      tx,
      { id: 'd1', organizationId: 'org-1', leadId: 'l1', campaignId: 'c1', subject: 'S', body: 'B', subjectVariantId: 'v1', subjectEdited: false },
      'mb-1',
      at,
    )
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1', leadId: 'l1', mailboxId: 'mb-1', draftId: 'd1', campaignId: 'c1',
        subjectVariantId: 'v1', subject: 'S', body: 'B', status: 'QUEUED', scheduledFor: at,
        messageId: expect.stringMatching(/^<.+@.+>$/),
      }),
    })
    create.mockClear()
    await queueApprovedDraft(
      tx,
      { id: 'd2', organizationId: 'org-1', leadId: 'l1', campaignId: null, subject: 'S', body: 'B', subjectVariantId: 'v1', subjectEdited: true },
      'mb-1',
    )
    expect(create.mock.calls[0][0].data.subjectVariantId).toBeUndefined()
  })
})
