import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/team/server/owners', () => ({ getLeadOwnerId: vi.fn() }))
vi.mock('@/features/drafts/server/generate-draft', () => ({ generateDraft: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getLeadOwnerId } from '@/features/team/server/owners'
import { generateDraft } from '@/features/drafts/server/generate-draft'
import { PendingDraftExistsError, LeadNotFoundError } from '@/features/drafts/types'
import { DraftGenerationError } from '@/lib/ai'
import { POST } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const call = (body: unknown = { leadId: 'lead-1' }) =>
  POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getLeadOwnerId).mockResolvedValue('m-rep')
  vi.mocked(generateDraft).mockResolvedValue({ id: 'draft-1' } as never)
})

describe('POST /api/drafts/generate', () => {
  it('403 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(403)
  })

  it('400 when leadId is missing', async () => {
    const res = await call({})
    expect(res.status).toBe(400)
    expect(getLeadOwnerId).not.toHaveBeenCalled()
  })

  it('409 PENDING_DRAFT_EXISTS', async () => {
    vi.mocked(generateDraft).mockRejectedValue(new PendingDraftExistsError('draft-9'))
    const res = await call()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('PENDING_DRAFT_EXISTS')
  })

  it('404 when the lead is not found', async () => {
    vi.mocked(generateDraft).mockRejectedValue(new LeadNotFoundError())
    expect((await call()).status).toBe(404)
  })

  it('502 DRAFT_GENERATION_FAILED', async () => {
    vi.mocked(generateDraft).mockRejectedValue(new DraftGenerationError('AI failed'))
    const res = await call()
    expect(res.status).toBe(502)
    expect((await res.json()).code).toBe('DRAFT_GENERATION_FAILED')
  })

  it.each([
    ["another rep's lead", rep, 'm-other', 403],
    ['an unassigned lead', rep, null, 403],
    ['their own lead', rep, 'm-rep', 201],
    ['any lead as admin', admin, 'm-other', 201],
  ])('member generating a draft for %s → %i', async (_label, ctx, ownerId, status) => {
    vi.mocked(resolveMember).mockResolvedValue(ctx as never)
    vi.mocked(getLeadOwnerId).mockResolvedValue(ownerId as string | null)
    const res = await call()
    expect(res.status).toBe(status)
    if (status === 403) {
      expect((await res.json()).code).toBe('NOT_OWNER')
      expect(generateDraft).not.toHaveBeenCalled()
    }
  })

  it('looks up ownership keyed on body.leadId, after body validation', async () => {
    await call({ leadId: 'lead-42' })
    expect(getLeadOwnerId).toHaveBeenCalledWith('org-1', 'lead-42')
  })

  it('generates with the caller\'s clerkUserId as actor', async () => {
    await call()
    expect(generateDraft).toHaveBeenCalledWith({ organizationId: 'org-1', leadId: 'lead-1', clerkUserId: 'user_rep' })
  })
})
