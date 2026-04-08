import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { Header } from '@/components/layout/header'
import { KpiGrid } from '@/features/analytics/components/kpi-grid'
import { getAnalytics } from '@/features/analytics/server/get-analytics'
import { RepliesTable } from '@/features/replies/components/replies-table'
import { getReplies } from '@/features/replies/server/get-replies'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function AnalyticsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)

  const [analytics, { replies: recentReplies }] = await Promise.all([
    getAnalytics({ organizationId: org.id }),
    getReplies({ organizationId: org.id, limit: 5 }),
  ])

  return (
    <>
      <Header title="Analytics" />
      <div className="flex-1 p-6 space-y-8">

        <KpiGrid analytics={analytics} />

        <div>
          <h2 className="text-[var(--text-muted)] text-xs uppercase tracking-wide font-medium mb-3">
            Recent Replies
          </h2>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
            <RepliesTable replies={recentReplies} />
          </div>
        </div>

        <p className="text-[var(--text-muted)] text-xs leading-relaxed">
          Delivered, opened, clicked, bounced, and unsubscribe counts reflect unique emails (one message counted once per event type regardless of how many events were received). Positive replies are classified by AI.
        </p>

      </div>
    </>
  )
}
