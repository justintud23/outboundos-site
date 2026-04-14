import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { DashboardClient } from './dashboard-client'
import { getDashboardSummary } from '@/features/dashboard/server/get-dashboard-summary'
import { getFunnelData } from '@/features/analytics/server/get-funnel-data'
import { getDailyActivity } from '@/features/analytics/server/get-daily-activity'
import { getClassificationBreakdown } from '@/features/analytics/server/get-classification-breakdown'
import { getCampaignPerformance } from '@/features/analytics/server/get-campaign-performance'
import { getReplies } from '@/features/replies/server/get-replies'
import { getNextActions } from '@/features/actions/server/get-next-actions'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function DashboardPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/sign-in')
  }

  const org = await resolveOrganization(orgId)

  const [summary, funnel, activity, classification, campaigns, { replies: recentReplies }, actions] = await Promise.all([
    getDashboardSummary({ organizationId: org.id }),
    getFunnelData({ organizationId: org.id }),
    getDailyActivity({ organizationId: org.id }),
    getClassificationBreakdown({ organizationId: org.id }),
    getCampaignPerformance({ organizationId: org.id }),
    getReplies({ organizationId: org.id, limit: 5 }),
    getNextActions({ organizationId: org.id, limit: 5 }),
  ])

  return (
    <>
      <Header title="Dashboard" />
      <div className="flex-1 p-6 lg:p-8">
        <DashboardClient
          initialData={{ summary, funnel, activity, classification, campaigns, recentReplies }}
          initialActions={actions}
        />
      </div>
    </>
  )
}
