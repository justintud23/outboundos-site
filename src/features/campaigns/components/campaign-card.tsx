import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { CampaignSummaryDTO, CampaignStatus } from '@/features/campaigns/server/get-campaigns'

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

export function CampaignCard({ campaign }: { campaign: CampaignSummaryDTO }) {
  const totalDrafts = campaign.draftPendingCount + campaign.draftApprovedCount

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
      <div className="grid grid-cols-3 gap-2 py-2 border-t border-[#1e2130]">
        <div>
          <p className="text-[#475569] text-xs uppercase tracking-wide mb-0.5">Sent</p>
          <p className="text-[#e2e8f0] text-sm font-medium tabular-nums">{campaign.messageCount.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[#475569] text-xs uppercase tracking-wide mb-0.5">Drafts</p>
          <p className="text-[#e2e8f0] text-sm font-medium tabular-nums">
            {totalDrafts.toLocaleString()}
            {campaign.draftPendingCount > 0 && (
              <span className="text-[#f59e0b] text-xs ml-1">
                ({campaign.draftPendingCount} pending)
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[#475569] text-xs uppercase tracking-wide mb-0.5">Replies</p>
          <p className="text-[#e2e8f0] text-sm font-medium tabular-nums">{campaign.replyCount.toLocaleString()}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <span className="text-[#334155] text-xs">
          Created {campaign.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <Link
          href="/drafts"
          className="text-[#6366f1] text-xs hover:text-[#818cf8] transition-colors"
        >
          View Drafts →
        </Link>
      </div>
    </div>
  )
}
