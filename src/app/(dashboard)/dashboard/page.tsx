import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { RepliesTable } from '@/features/replies/components/replies-table'
import { getReplies } from '@/features/replies/server/get-replies'
import { getDashboardSummary } from '@/features/dashboard/server/get-dashboard-summary'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

interface StatCardProps {
  label: string
  value: number
  sub?: string
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="bg-[#13151c] border border-[#1e2130] rounded-lg p-5">
      <p className="text-[#475569] text-xs uppercase tracking-wide font-medium mb-2">{label}</p>
      <p className="text-3xl font-semibold tabular-nums text-[#e2e8f0]">{value.toLocaleString()}</p>
      {sub !== undefined && (
        <p className="text-[#475569] text-xs mt-1">{sub}</p>
      )}
    </div>
  )
}

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
          <StatCard label="Campaigns"     value={summary.campaigns} />
          <StatCard label="Messages Sent" value={summary.messagesSent} />
          <StatCard label="Replies"       value={summary.replies} sub={positiveRate} />
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[#475569] text-xs uppercase tracking-wide font-medium">
              Recent Replies
            </h2>
            <Link
              href="/replies"
              className="text-[#6366f1] text-xs hover:text-[#818cf8] transition-colors"
            >
              View all →
            </Link>
          </div>
          <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
            <RepliesTable replies={recentReplies} />
          </div>
        </div>

        <div className="flex gap-3">
          <Link
            href="/analytics"
            className="text-xs text-[#475569] hover:text-[#94a3b8] transition-colors"
          >
            Full analytics →
          </Link>
        </div>

      </div>
    </>
  )
}
