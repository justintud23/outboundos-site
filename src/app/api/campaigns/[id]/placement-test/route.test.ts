import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getCampaignOwnerId: vi.fn() }))
vi.mock('@/features/placement-test/server/send-placement-test', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>
  return { ...actual, sendPlacementTest: vi.fn() }
})

import { resolveMember } from '@/lib/auth/resolve-member'
import { getCampaignOwnerId } from '@/features/team/server/owners'
import { sendPlacementTest, PlacementTestError } from '@/features/placement-test/server/send-placement-test'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }), { params: Promise.resolve({ id: 'camp-1' }) })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getCampaignOwnerId).mockResolvedValue('m-rep')
})

const VALID_BODY = { sequenceId: 'seq-1', mailboxId: 'mb-1', seeds: ['a@tester.com'] }

describe('POST /api/campaigns/[id]/placement-test', () => {
  it('403 without an org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call(VALID_BODY)).status).toBe(403)
    expect(sendPlacementTest).not.toHaveBeenCalled()
  })

  it('400 on a malformed body', async () => {
    expect((await call({})).status).toBe(400)
    expect((await call({ sequenceId: 'seq-1', mailboxId: 'mb-1', seeds: 'not-an-array' })).status).toBe(400)
    expect((await call({ sequenceId: 'seq-1', mailboxId: 'mb-1', seeds: [1, 2] })).status).toBe(400)
    expect(sendPlacementTest).not.toHaveBeenCalled()
  })

  it('400 for INVALID_SEEDS', async () => {
    vi.mocked(sendPlacementTest).mockRejectedValue(new PlacementTestError('INVALID_SEEDS', 'Enter at least one seed address.'))
    const res = await call(VALID_BODY)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ code: 'INVALID_SEEDS', error: 'Enter at least one seed address.' })
  })

  it('404 for NOT_FOUND', async () => {
    vi.mocked(sendPlacementTest).mockRejectedValue(new PlacementTestError('NOT_FOUND', 'Campaign not found.'))
    expect((await call(VALID_BODY)).status).toBe(404)
  })

  it('429 for NO_CAPACITY', async () => {
    vi.mocked(sendPlacementTest).mockRejectedValue(new PlacementTestError('NO_CAPACITY', 'Only 1 sends left today.'))
    expect((await call(VALID_BODY)).status).toBe(429)
  })

  it('422 for all other codes', async () => {
    for (const code of ['MAILBOX_UNAVAILABLE', 'DOMAIN_NOT_HEALTHY', 'NO_FIRST_STEP', 'GUARDRAIL_BLOCKED', 'MISSING_POSTAL_ADDRESS', 'NOT_MICROSOFT'] as const) {
      vi.mocked(sendPlacementTest).mockRejectedValue(new PlacementTestError(code, `msg-${code}`))
      const res = await call(VALID_BODY)
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ code, error: `msg-${code}` })
    }
  })

  it('500 on an unexpected error', async () => {
    vi.mocked(sendPlacementTest).mockRejectedValue(new Error('boom'))
    expect((await call(VALID_BODY)).status).toBe(500)
  })

  it('200 on success, passing the parsed body through org-scoped', async () => {
    vi.mocked(sendPlacementTest).mockResolvedValue({ mailbox: 'rep@company.com', requested: 1, sent: 1, failed: [], personalizationSkipped: false })
    const res = await call({ ...VALID_BODY, leadId: 'lead-1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mailbox: 'rep@company.com', requested: 1, sent: 1, failed: [], personalizationSkipped: false })
    expect(sendPlacementTest).toHaveBeenCalledWith({
      organizationId: 'org-1',
      campaignId: 'camp-1',
      sequenceId: 'seq-1',
      mailboxId: 'mb-1',
      leadId: 'lead-1',
      seeds: ['a@tester.com'],
      clerkUserId: 'user_rep',
    })
  })

  it('defaults leadId to null when omitted', async () => {
    vi.mocked(sendPlacementTest).mockResolvedValue({ mailbox: 'rep@company.com', requested: 1, sent: 1, failed: [], personalizationSkipped: false })
    await call(VALID_BODY)
    expect(sendPlacementTest).toHaveBeenCalledWith(expect.objectContaining({ leadId: null }))
  })

  it('passes personalizationSkipped through to the client when the AI line failed', async () => {
    vi.mocked(sendPlacementTest).mockResolvedValue({ mailbox: 'rep@company.com', requested: 1, sent: 1, failed: [], personalizationSkipped: true })
    const res = await call(VALID_BODY)
    expect(await res.json()).toMatchObject({ personalizationSkipped: true })
  })

  it.each([
    ["another rep's campaign", rep, 'm-other', 403],
    ['an unassigned campaign', rep, null, 403],
    ['their own campaign', rep, 'm-rep', 200],
    ['any campaign as admin', admin, 'm-other', 200],
  ])('member acting on %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getCampaignOwnerId).mockResolvedValue(ownerId as string | null)
    vi.mocked(sendPlacementTest).mockResolvedValue({ mailbox: 'rep@company.com', requested: 1, sent: 1, failed: [], personalizationSkipped: false })
    const res = await call(VALID_BODY)
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(sendPlacementTest).not.toHaveBeenCalled()
    }
  })
})
