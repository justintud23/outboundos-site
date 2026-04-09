import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getAnalytics } from '@/features/analytics/server/get-analytics'
import { getFunnelData } from '@/features/analytics/server/get-funnel-data'
import { getDailyActivityExtended } from '@/features/analytics/server/get-daily-activity-extended'
import { getCampaignPerformance } from '@/features/analytics/server/get-campaign-performance'
import { getClassificationBreakdown } from '@/features/analytics/server/get-classification-breakdown'

export async function GET(request: Request) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const org = await resolveOrganization(orgId)
  const url = new URL(request.url)
  const days = parseInt(url.searchParams.get('days') ?? '30', 10)

  const [analytics, funnel, activity, campaigns, classification] = await Promise.all([
    getAnalytics({ organizationId: org.id }),
    getFunnelData({ organizationId: org.id, days }),
    getDailyActivityExtended({ organizationId: org.id, days }),
    getCampaignPerformance({ organizationId: org.id, days }),
    getClassificationBreakdown({ organizationId: org.id, days }),
  ])

  return NextResponse.json({ analytics, funnel, activity, campaigns, classification })
}
