import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { lead: { count: vi.fn() }, organization: { findUniqueOrThrow: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'
import { getVerificationSummary } from './get-verification-summary'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as { lead: { count: Fn }; organization: { findUniqueOrThrow: Fn } }

beforeEach(() => {
  vi.resetAllMocks()
  process.env.MILLIONVERIFIER_API_KEY = 'k'
})
afterEach(() => { delete process.env.MILLIONVERIFIER_API_KEY })

describe('getVerificationSummary', () => {
  it('counts pending, risky and invalid among enrolled leads and returns the paused reason', async () => {
    p.lead.count.mockImplementation(async ({ where }: { where: { emailCheck: string } }) => ({ PENDING: 4, RISKY: 2, INVALID: 1 })[where.emailCheck] ?? 0)
    p.organization.findUniqueOrThrow.mockResolvedValue({ verificationPausedReason: 'out of MillionVerifier credits' })
    expect(await getVerificationSummary('org-1')).toEqual({ configured: true, pending: 4, risky: 2, invalid: 1, pausedReason: 'out of MillionVerifier credits' })
    expect(p.lead.count).toHaveBeenCalledWith({ where: { organizationId: 'org-1', sequenceEnrollments: { some: {} }, emailCheck: 'PENDING' } })
  })

  it('reports unconfigured without a key', async () => {
    delete process.env.MILLIONVERIFIER_API_KEY
    p.lead.count.mockResolvedValue(0)
    p.organization.findUniqueOrThrow.mockResolvedValue({ verificationPausedReason: null })
    expect((await getVerificationSummary('org-1')).configured).toBe(false)
  })
})
