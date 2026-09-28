import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))
vi.mock('@/features/dashboard/server/get-dashboard-summary', () => ({ getDashboardSummary: vi.fn() }))
vi.mock('@/features/analytics/server/get-funnel-data', () => ({ getFunnelData: vi.fn() }))
vi.mock('@/features/analytics/server/get-daily-activity', () => ({ getDailyActivity: vi.fn() }))
vi.mock('@/features/analytics/server/get-classification-breakdown', () => ({ getClassificationBreakdown: vi.fn() }))
vi.mock('@/features/analytics/server/get-campaign-performance', () => ({ getCampaignPerformance: vi.fn() }))
vi.mock('@/features/replies/server/get-replies', () => ({ getReplies: vi.fn() }))

import { resolveMember } from '@/lib/auth/resolve-member'
import { getDashboardSummary } from '@/features/dashboard/server/get-dashboard-summary'
import { getFunnelData } from '@/features/analytics/server/get-funnel-data'
import { getDailyActivity } from '@/features/analytics/server/get-daily-activity'
import { getClassificationBreakdown } from '@/features/analytics/server/get-classification-breakdown'
import { getCampaignPerformance } from '@/features/analytics/server/get-campaign-performance'
import { getReplies } from '@/features/replies/server/get-replies'
import { GET } from './route'

const rep = { org: { id: 'org-1' }, member: { id: 'm-rep' }, isAdmin: false }
const admin = { org: { id: 'org-1' }, member: { id: 'm-admin' }, isAdmin: true }

const call = (query = '') => GET(new Request(`http://x/api/dashboard/refresh${query}`))

const emptySummary = { leads: 0, campaigns: 0, messagesSent: 0, replies: 0, positiveReplies: 0 }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resolveMember).mockResolvedValue(rep as never)
  vi.mocked(getDashboardSummary).mockResolvedValue(emptySummary as never)
  vi.mocked(getFunnelData).mockResolvedValue([] as never)
  vi.mocked(getDailyActivity).mockResolvedValue([] as never)
  vi.mocked(getClassificationBreakdown).mockResolvedValue([] as never)
  vi.mocked(getCampaignPerformance).mockResolvedValue([] as never)
  vi.mocked(getReplies).mockResolvedValue({ replies: [], total: 0 } as never)
})

describe('GET /api/dashboard/refresh', () => {
  it('401 without an active org', async () => {
    vi.mocked(resolveMember).mockResolvedValue(null)
    expect((await call()).status).toBe(401)
  })

  it('member default (no ?view) filters to their own leads/replies', async () => {
    await call()
    expect(getDashboardSummary).toHaveBeenCalledWith({ organizationId: 'org-1', ownerId: 'm-rep' })
    expect(getReplies).toHaveBeenCalledWith({ organizationId: 'org-1', limit: 5, ownerId: 'm-rep' })
  })

  it('?view=mine filters to the caller', async () => {
    await call('?view=mine')
    expect(getDashboardSummary).toHaveBeenCalledWith({ organizationId: 'org-1', ownerId: 'm-rep' })
    expect(getReplies).toHaveBeenCalledWith({ organizationId: 'org-1', limit: 5, ownerId: 'm-rep' })
  })

  it('?view=team removes the owner filter', async () => {
    await call('?view=team')
    expect(getDashboardSummary).toHaveBeenCalledWith({ organizationId: 'org-1', ownerId: undefined })
    expect(getReplies).toHaveBeenCalledWith({ organizationId: 'org-1', limit: 5, ownerId: undefined })
  })

  it('admin default (no ?view) is unfiltered', async () => {
    vi.mocked(resolveMember).mockResolvedValue(admin as never)
    await call()
    expect(getDashboardSummary).toHaveBeenCalledWith({ organizationId: 'org-1', ownerId: undefined })
    expect(getReplies).toHaveBeenCalledWith({ organizationId: 'org-1', limit: 5, ownerId: undefined })
  })

  it('an admin can still request ?view=mine', async () => {
    vi.mocked(resolveMember).mockResolvedValue(admin as never)
    await call('?view=mine')
    expect(getDashboardSummary).toHaveBeenCalledWith({ organizationId: 'org-1', ownerId: 'm-admin' })
  })

  it('passes days through to the day-scoped analytics calls, unaffected by view', async () => {
    await call('?days=7&view=team')
    expect(getFunnelData).toHaveBeenCalledWith({ organizationId: 'org-1', days: 7 })
    expect(getDailyActivity).toHaveBeenCalledWith({ organizationId: 'org-1', days: 7 })
    expect(getClassificationBreakdown).toHaveBeenCalledWith({ organizationId: 'org-1', days: 7 })
    expect(getCampaignPerformance).toHaveBeenCalledWith({ organizationId: 'org-1', days: 7 })
  })
})
