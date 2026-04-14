import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { AnalyticsClient } from './analytics-client'
import { getAnalytics } from '@/features/analytics/server/get-analytics'
import { getFunnelData } from '@/features/analytics/server/get-funnel-data'
import { getDailyActivityExtended } from '@/features/analytics/server/get-daily-activity-extended'
import { getCampaignPerformance } from '@/features/analytics/server/get-campaign-performance'
import { getClassificationBreakdown } from '@/features/analytics/server/get-classification-breakdown'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function AnalyticsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)

  const [analytics, funnel, activity, campaigns, classification] = await Promise.all([
    getAnalytics({ organizationId: org.id }),
    getFunnelData({ organizationId: org.id }),
    getDailyActivityExtended({ organizationId: org.id }),
    getCampaignPerformance({ organizationId: org.id }),
    getClassificationBreakdown({ organizationId: org.id }),
  ])

  return (
    <>
      <Header title="Analytics" />
      <div className="flex-1 p-6 lg:p-8">
        <AnalyticsClient
          initialData={{ analytics, funnel, activity, campaigns, classification }}
        />
      </div>
    </>
  )
}
