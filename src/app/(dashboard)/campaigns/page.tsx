import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/header'
import { Badge } from '@/components/ui/badge'
import { getCampaigns } from '@/features/campaigns/server/get-campaigns'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import type { CampaignSummaryDTO } from '@/features/campaigns/server/get-campaigns'
import type { CampaignStatus } from '@prisma/client'

// ─── Badge helpers ─────────────────────────────────────────────────────────────

const STATUS_VARIANT: Record<CampaignStatus, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
  DRAFT:     'muted',
  ACTIVE:    'success',
  PAUSED:    'warning',
  COMPLETED: 'default',
  ARCHIVED:  'muted',
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

// ─── Campaign card ─────────────────────────────────────────────────────────────

function CampaignCard({ campaign }: { campaign: CampaignSummaryDTO }) {
  return (
    <div className="bg-[#13151c] border border-[#1e2130] rounded-lg p-5 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[#e2e8f0] font-semibold text-sm leading-snug">
          {campaign.name}
        </h2>
        <Badge variant={STATUS_VARIANT[campaign.status]}>
          {capitalize(campaign.status)}
        </Badge>
      </div>

      {/* Description */}
      {campaign.description && (
        <p className="text-[#94a3b8] text-xs leading-relaxed">
          {campaign.description}
        </p>
      )}

      {/* Stats */}
      <p className="text-[#475569] text-xs">
        {campaign.messageCount} message{campaign.messageCount !== 1 ? 's' : ''}
        {' · '}
        {campaign.draftPendingCount} pending draft{campaign.draftPendingCount !== 1 ? 's' : ''}
        {' · '}
        {campaign.draftApprovedCount} approved draft{campaign.draftApprovedCount !== 1 ? 's' : ''}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-[#334155] text-xs">
          Created {campaign.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <Link
          href="/drafts"
          className="text-[#6366f1] text-xs hover:underline"
        >
          View Drafts →
        </Link>
      </div>
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

  return (
    <>
      <Header title="Campaigns" />
      <div className="flex-1 p-6 space-y-4">
        <p className="text-[#94a3b8] text-sm">
          {total} campaign{total !== 1 ? 's' : ''}
        </p>

        {campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-[#475569] text-sm">No campaigns yet.</p>
          </div>
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
