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
import { resolveMember } from '@/lib/auth/resolve-member'
import { resolveView, ownerFilterFor } from '@/features/team/view'

interface DashboardPageProps {
  searchParams: Promise<{ view?: string | string[] }>
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const ctx = await resolveMember()

  if (!ctx) {
    redirect('/sign-in')
  }

  const view = resolveView(ctx.isAdmin, (await searchParams).view)
  const ownerId = ownerFilterFor(view, ctx.member.id)

  const [summary, funnel, activity, classification, campaigns, { replies: recentReplies }, actions] = await Promise.all([
    getDashboardSummary({ organizationId: ctx.org.id, ownerId }),
    getFunnelData({ organizationId: ctx.org.id }),
    getDailyActivity({ organizationId: ctx.org.id }),
    getClassificationBreakdown({ organizationId: ctx.org.id }),
    getCampaignPerformance({ organizationId: ctx.org.id }),
    getReplies({ organizationId: ctx.org.id, limit: 5, ownerId }),
    getNextActions({ organizationId: ctx.org.id, limit: 5 }),
  ])

  return (
    <>
      <Header title="Dashboard" />
      <div className="flex-1 p-6 lg:p-8">
        <DashboardClient
          initialData={{ summary, funnel, activity, classification, campaigns, recentReplies }}
          initialActions={actions}
          view={view}
        />
      </div>
    </>
  )
}
