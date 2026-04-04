import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { getCampaigns } from '@/features/campaigns/server/get-campaigns'
import { CampaignCard } from '@/features/campaigns/components/campaign-card'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

// ─── Summary cards ─────────────────────────────────────────────────────────────

interface SummaryCardProps {
  label: string
  value: number
}

function SummaryCard({ label, value }: SummaryCardProps) {
  return (
    <div className="bg-[#13151c] border border-[#1e2130] rounded-lg p-4">
      <p className="text-[#475569] text-xs uppercase tracking-wide font-medium mb-1">{label}</p>
      <p className="text-2xl font-semibold tabular-nums text-[#e2e8f0]">{value.toLocaleString()}</p>
    </div>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-[#475569] text-sm">No campaigns yet.</p>
      <p className="text-[#334155] text-xs mt-1">
        Create a campaign to start sending outreach emails to your leads.
      </p>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function CampaignsPage() {
  const { orgId } = await auth()

  if (!orgId) {
    redirect('/dashboard')
  }

  const org = await resolveOrganization(orgId)
  const { campaigns, total } = await getCampaigns({ organizationId: org.id })

  const totalMessages = campaigns.reduce((s, c) => s + c.messageCount, 0)
  const totalPending  = campaigns.reduce((s, c) => s + c.draftPendingCount, 0)
  const totalReplies  = campaigns.reduce((s, c) => s + c.replyCount, 0)

  return (
    <>
      <Header title="Campaigns" />
      <div className="flex-1 p-6 space-y-6">

        {/* Summary row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryCard label="Campaigns"      value={total} />
          <SummaryCard label="Messages Sent"  value={totalMessages} />
          <SummaryCard label="Pending Drafts" value={totalPending} />
          <SummaryCard label="Replies"        value={totalReplies} />
        </div>

        {/* Sub-header */}
        <div className="flex items-center justify-between">
          <p className="text-[#94a3b8] text-sm">
            {total} campaign{total !== 1 ? 's' : ''}
          </p>
          <Link
            href="/analytics"
            className="text-[#475569] text-xs hover:text-[#94a3b8] transition-colors"
          >
            Full analytics →
          </Link>
        </div>

        {/* Campaign cards */}
        {campaigns.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {campaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        )}

      </div>
    </>
  )
}
