import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    inboundReply: { findFirst: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { checkEnrollmentStop } from './check-enrollment-stop'

const mockReplyFind = prisma.inboundReply.findFirst as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetAllMocks()
})

describe('checkEnrollmentStop', () => {
  it('returns shouldStop=true if lead is in terminal state', async () => {
    const result = await checkEnrollmentStop({
      enrollment: { startedAt: new Date('2026-01-01'), leadId: 'lead-1', organizationId: 'org-1' },
      leadStatus: 'UNSUBSCRIBED',
    })
    expect(result.shouldStop).toBe(true)
    expect(result.reason).toBe('lead_unsubscribed')
  })

  it('returns shouldStop=true if reply exists after enrollment started', async () => {
    mockReplyFind.mockResolvedValue({ id: 'reply-1' })
    const result = await checkEnrollmentStop({
      enrollment: { startedAt: new Date('2026-01-01'), leadId: 'lead-1', organizationId: 'org-1' },
      leadStatus: 'REPLIED',
    })
    expect(result.shouldStop).toBe(true)
    expect(result.reason).toBe('reply_received')
  })

  it('returns shouldStop=false if no stop conditions met', async () => {
    mockReplyFind.mockResolvedValue(null)
    const result = await checkEnrollmentStop({
      enrollment: { startedAt: new Date('2026-01-01'), leadId: 'lead-1', organizationId: 'org-1' },
      leadStatus: 'NEW',
    })
    expect(result.shouldStop).toBe(false)
  })
})
