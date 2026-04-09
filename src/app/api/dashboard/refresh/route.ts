import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getDashboardSummary } from '@/features/dashboard/server/get-dashboard-summary'
import { getFunnelData } from '@/features/analytics/server/get-funnel-data'
import { getDailyActivity } from '@/features/analytics/server/get-daily-activity'
import { getClassificationBreakdown } from '@/features/analytics/server/get-classification-breakdown'
import { getCampaignPerformance } from '@/features/analytics/server/get-campaign-performance'
import { getReplies } from '@/features/replies/server/get-replies'

export async function GET(request: Request) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const org = await resolveOrganization(orgId)
  const url = new URL(request.url)
  const days = parseInt(url.searchParams.get('days') ?? '30', 10)

  const [summary, funnel, activity, classification, campaigns, { replies: recentReplies }] = await Promise.all([
    getDashboardSummary({ organizationId: org.id }),
    getFunnelData({ organizationId: org.id, days }),
    getDailyActivity({ organizationId: org.id, days }),
    getClassificationBreakdown({ organizationId: org.id, days }),
    getCampaignPerformance({ organizationId: org.id, days }),
    getReplies({ organizationId: org.id, limit: 5 }),
  ])

  return NextResponse.json({ summary, funnel, activity, classification, campaigns, recentReplies })
}
