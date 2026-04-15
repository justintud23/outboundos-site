import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { StatCard } from '@/components/ui/stat-card'
import { getCampaigns } from '@/features/campaigns/server/get-campaigns'
import { CampaignCard } from '@/features/campaigns/components/campaign-card'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <p className="text-[var(--text-muted)] text-sm">No campaigns yet.</p>
      <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">
        Create a campaign to start sending outreach emails to your leads.
      </p>
    </div>
  )
}

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
      <div className="flex-1 p-6 lg:p-8 space-y-6">

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Campaigns"      value={total} accent="cyan" />
          <StatCard label="Messages Sent"  value={totalMessages} />
          <StatCard label="Pending Drafts" value={totalPending} accent={totalPending > 0 ? 'warning' : undefined} />
          <StatCard label="Replies"        value={totalReplies} accent="success" />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-[var(--text-secondary)] text-sm">
            {total} campaign{total !== 1 ? 's' : ''}
          </p>
          <Link
            href="/analytics"
            className="text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors"
          >
            Full analytics &rarr;
          </Link>
        </div>

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
