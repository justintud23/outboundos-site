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
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5 flex flex-col gap-3 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)] transition-all duration-[var(--transition-base)]">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/campaigns/${campaign.id}`}
          className="text-[var(--text-primary)] font-semibold text-sm leading-snug hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          {campaign.name}
        </Link>
        <Badge variant={STATUS_VARIANT[campaign.status]}>
          {capitalize(campaign.status)}
        </Badge>
      </div>

      {campaign.description && (
        <p className="text-[var(--text-secondary)] text-xs leading-relaxed">
          {campaign.description}
        </p>
      )}

      <div className="grid grid-cols-3 gap-2 py-2 border-t border-[var(--border-subtle)]">
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Sent</p>
          <p className="text-[var(--text-primary)] text-sm font-medium tabular-nums">{campaign.messageCount.toLocaleString()}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Drafts</p>
          <p className="text-[var(--text-primary)] text-sm font-medium tabular-nums">
            {totalDrafts.toLocaleString()}
            {campaign.draftPendingCount > 0 && (
              <span className="text-[var(--status-warning)] text-xs ml-1">
                ({campaign.draftPendingCount} pending)
              </span>
            )}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Replies</p>
          <p className="text-[var(--text-primary)] text-sm font-medium tabular-nums">{campaign.replyCount.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[var(--text-muted)] text-xs">
          Created {campaign.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <Link
          href={`/campaigns/${campaign.id}`}
          className="text-[var(--accent-indigo)] text-xs hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          View Details &rarr;
        </Link>
      </div>
    </div>
  )
}
