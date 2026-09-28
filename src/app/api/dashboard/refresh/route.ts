import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { resolveView, ownerFilterFor } from '@/features/team/view'
import { getDashboardSummary } from '@/features/dashboard/server/get-dashboard-summary'
import { getFunnelData } from '@/features/analytics/server/get-funnel-data'
import { getDailyActivity } from '@/features/analytics/server/get-daily-activity'
import { getClassificationBreakdown } from '@/features/analytics/server/get-classification-breakdown'
import { getCampaignPerformance } from '@/features/analytics/server/get-campaign-performance'
import { getReplies } from '@/features/replies/server/get-replies'

export async function GET(request: Request) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const days = parseInt(url.searchParams.get('days') ?? '30', 10)
  const view = resolveView(ctx.isAdmin, url.searchParams.get('view') ?? undefined)
  const ownerId = ownerFilterFor(view, ctx.member.id)

  const [summary, funnel, activity, classification, campaigns, { replies: recentReplies }] = await Promise.all([
    getDashboardSummary({ organizationId: ctx.org.id, ownerId }),
    getFunnelData({ organizationId: ctx.org.id, days }),
    getDailyActivity({ organizationId: ctx.org.id, days }),
    getClassificationBreakdown({ organizationId: ctx.org.id, days }),
    getCampaignPerformance({ organizationId: ctx.org.id, days }),
    getReplies({ organizationId: ctx.org.id, limit: 5, ownerId }),
  ])

  return NextResponse.json({ summary, funnel, activity, classification, campaigns, recentReplies })
}
