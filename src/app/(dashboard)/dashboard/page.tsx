import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { StatCard } from '@/components/ui/stat-card'
import { RepliesTable } from '@/features/replies/components/replies-table'
import { getReplies } from '@/features/replies/server/get-replies'
import { getDashboardSummary } from '@/features/dashboard/server/get-dashboard-summary'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export default async function DashboardPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/sign-in')
  }

  const org = await resolveOrganization(orgId)

  const [summary, { replies: recentReplies }] = await Promise.all([
    getDashboardSummary({ organizationId: org.id }),
    getReplies({ organizationId: org.id, limit: 5 }),
  ])

  const positiveRate =
    summary.replies > 0
      ? `${((summary.positiveReplies / summary.replies) * 100).toFixed(1)}% positive`
      : undefined

  return (
    <>
      <Header title="Dashboard" />
      <div className="flex-1 p-6 space-y-8">

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Leads"         value={summary.leads} />
          <StatCard label="Campaigns"     value={summary.campaigns} accent="cyan" />
          <StatCard label="Messages Sent" value={summary.messagesSent} />
          <StatCard label="Replies"       value={summary.replies} sub={positiveRate} accent="success" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[var(--text-muted)] text-xs uppercase tracking-wide font-medium">
              Recent Replies
            </h2>
            <Link
              href="/replies"
              className="text-[var(--accent-indigo)] text-xs hover:text-[var(--accent-indigo-hover)] transition-colors"
            >
              View all &rarr;
            </Link>
          </div>
          <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
            <RepliesTable replies={recentReplies} />
          </div>
        </div>

        <div className="flex gap-3">
          <Link
            href="/analytics"
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Full analytics &rarr;
          </Link>
        </div>

      </div>
    </>
  )
}
