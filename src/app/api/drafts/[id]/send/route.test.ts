import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getDraftOwnerId: vi.fn() }))
vi.mock('@/features/messages/server/send-draft', () => ({ sendDraft: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getDraftOwnerId } from '@/features/team/server/owners'
import { sendDraft } from '@/features/messages/server/send-draft'
import {
  DraftOnSendQueueError,
  DomainNotHealthyError,
  EmailNotVerifiedError,
  LeadBlockedBySalesforceError,
  SalesforceCheckUnavailableError,
} from '@/features/messages/types'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = () => POST(new Request('http://x', { method: 'POST' }), { params: Promise.resolve({ id: 'draft-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getDraftOwnerId).mockResolvedValue('m-rep')
  vi.mocked(sendDraft).mockResolvedValue({ id: 'msg-1' } as never)
})

describe('POST /api/drafts/[id]/send', () => {
  it('403 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(403)
  })

  it('409 DRAFT_ON_SEND_QUEUE when the draft is queued for automatic sending', async () => {
    vi.mocked(sendDraft).mockRejectedValue(new DraftOnSendQueueError('QUEUED', 'msg-1'))
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
    vi.mocked(sendDraft).mockRejectedValue(new DraftOnSendQueueError('FAILED', 'msg-1'))
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/use Retry/)
  })
  it('422 DOMAIN_NOT_HEALTHY when the sending mailbox is on a blocked domain', async () => {
    vi.mocked(sendDraft).mockRejectedValue(new DomainNotHealthyError('bad.com', 'FAILING'))
    const res = await call()
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'DOMAIN_NOT_HEALTHY', domain: 'bad.com' })
  })
  it('422 EMAIL_NOT_VERIFIED when the lead\'s first email is not cleared', async () => {
    vi.mocked(sendDraft).mockRejectedValue(new EmailNotVerifiedError('stop', 'Email failed verification (invalid)'))
    const res = await call()
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED', state: 'stop' })
  })
  it('422 SALESFORCE_BLOCKED when the lead is blocked by Salesforce', async () => {
    vi.mocked(sendDraft).mockRejectedValue(new LeadBlockedBySalesforceError('Salesforce: customer (Acme)'))
    const res = await call()
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ code: 'SALESFORCE_BLOCKED', error: 'Salesforce: customer (Acme)' })
  })
  it('503 SALESFORCE_UNAVAILABLE when the Salesforce check cannot complete', async () => {
    vi.mocked(sendDraft).mockRejectedValue(new SalesforceCheckUnavailableError())
    const res = await call()
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ code: 'SALESFORCE_UNAVAILABLE', error: "Couldn't check Salesforce; try again shortly." })
  })

  it.each([
    ["another rep's draft", rep, 'm-other', 403],
    ['an unassigned draft', rep, null, 403],
    ['their own draft', rep, 'm-rep', 201],
    ['any draft as admin', admin, 'm-other', 201],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getDraftOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(sendDraft).not.toHaveBeenCalled()
    }
  })

  it('sends with the caller\'s clerkUserId as actor', async () => {
    await call()
    expect(sendDraft).toHaveBeenCalledWith({ organizationId: 'org-1', draftId: 'draft-1', clerkUserId: 'user_rep' })
  })
})
