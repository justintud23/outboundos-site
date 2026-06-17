import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/email/unsubscribe-token', () => ({
  verifyUnsubscribeToken: vi.fn(),
}))

vi.mock('@/features/leads/server/transition-lead-status', () => ({
  transitionLeadStatus: vi.fn(),
}))

import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe-token'
import { transitionLeadStatus } from '@/features/leads/server/transition-lead-status'
import { LeadNotFoundError } from '@/features/leads/types'
import { GET, POST } from './route'

const mockVerify = verifyUnsubscribeToken as ReturnType<typeof vi.fn>
const mockTransition = transitionLeadStatus as ReturnType<typeof vi.fn>

function req(url: string, method = 'GET'): Request {
  return new Request(url, { method })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTransition.mockResolvedValue({ changed: true, lead: {}, previousStatus: 'CONTACTED' })
})

describe('GET /api/unsubscribe', () => {
  it('unsubscribes the token lead and returns an HTML confirmation', async () => {
    mockVerify.mockReturnValue({ leadId: 'lead-1', organizationId: 'org-1' })

    const res = await GET(req('https://app.test/api/unsubscribe?token=good'))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toContain('unsubscribed')
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        leadId: 'lead-1',
        newStatus: 'UNSUBSCRIBED',
        trigger: expect.stringMatching(/^auto:/),
      }),
    )
  })

  it('uses the org from the TOKEN, never an org id supplied in the request', async () => {
    mockVerify.mockReturnValue({ leadId: 'lead-1', organizationId: 'org-from-token' })

    await GET(req('https://app.test/api/unsubscribe?token=good&organizationId=org-EVIL'))

    // The attacker-supplied ?organizationId is ignored; token org wins.
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org-from-token' }),
    )
  })

  it('is idempotent on repeat hits (auto trigger no-ops an already-unsubscribed lead)', async () => {
    mockVerify.mockReturnValue({ leadId: 'lead-1', organizationId: 'org-1' })
    // Simulate the second hit: lead already terminal → transition is a no-op.
    mockTransition.mockResolvedValue({ changed: false, lead: {}, previousStatus: 'UNSUBSCRIBED' })

    const r1 = await GET(req('https://app.test/api/unsubscribe?token=good'))
    const r2 = await GET(req('https://app.test/api/unsubscribe?token=good'))

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    expect(mockTransition).toHaveBeenCalledTimes(2)
    // The auto: trigger is what makes the repeat a no-op (no duplicate change).
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: expect.stringMatching(/^auto:/) }),
    )
  })

  it('returns the same generic page and does NOT transition on an invalid/tampered token', async () => {
    mockVerify.mockReturnValue(null)

    const res = await GET(req('https://app.test/api/unsubscribe?token=tampered'))

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('unsubscribed')
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('does not even verify (and does not transition) when the token is missing', async () => {
    const res = await GET(req('https://app.test/api/unsubscribe'))

    expect(res.status).toBe(200)
    expect(mockVerify).not.toHaveBeenCalled()
    expect(mockTransition).not.toHaveBeenCalled()
  })

  it('still returns 200 when the token is valid but the lead no longer exists', async () => {
    mockVerify.mockReturnValue({ leadId: 'gone', organizationId: 'org-1' })
    mockTransition.mockRejectedValue(new LeadNotFoundError('gone'))

    const res = await GET(req('https://app.test/api/unsubscribe?token=good'))

    expect(res.status).toBe(200)
  })
})

describe('POST /api/unsubscribe (RFC 8058 one-click)', () => {
  it('unsubscribes the token lead and returns an empty 200', async () => {
    mockVerify.mockReturnValue({ leadId: 'lead-1', organizationId: 'org-1' })

    const res = await POST(req('https://app.test/api/unsubscribe?token=good', 'POST'))

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-1', organizationId: 'org-1', newStatus: 'UNSUBSCRIBED' }),
    )
  })

  it('returns 200 and does NOT transition on an invalid token', async () => {
    mockVerify.mockReturnValue(null)

    const res = await POST(req('https://app.test/api/unsubscribe?token=bad', 'POST'))

    expect(res.status).toBe(200)
    expect(mockTransition).not.toHaveBeenCalled()
  })
})
