import { Badge } from '@/components/ui/badge'
import { formatEnumLabel } from '@/lib/format'
import type { LeadDTO } from '../types'

interface LeadsTableProps {
  leads: LeadDTO[]
  pendingDrafts?: Map<string, string>
  onGenerateDraft?: (leadId: string) => Promise<void>
  onReviewDraft?: (leadId: string) => void
  generatingLeadId?: string | null
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-[var(--text-muted)] text-xs">&mdash;</span>
  const variant = score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger'
  return <Badge variant={variant}>{score}</Badge>
}

function StatusBadge({ status }: { status: LeadDTO['status'] }) {
  const variantMap: Record<LeadDTO['status'], 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
    NEW: 'default',
    CONTACTED: 'warning',
    REPLIED: 'success',
    BOUNCED: 'danger',
    UNSUBSCRIBED: 'danger',
    CONVERTED: 'success',
    INTERESTED: 'success',
    NOT_INTERESTED: 'danger',
  }
  return <Badge variant={variantMap[status]}>{formatEnumLabel(status)}</Badge>
}

export function LeadsTable({
  leads,
  pendingDrafts,
  onGenerateDraft,
  onReviewDraft,
  generatingLeadId,
}: LeadsTableProps) {
  const showActions = !!onGenerateDraft

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[var(--text-muted)] text-sm">No leads yet.</p>
        <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">Import a CSV to get started.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)]">
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Name</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Company</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Title</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Score</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Score Reason</th>
            {showActions && (
              <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Actions</th>
            )}
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => {
            const hasPendingDraft = pendingDrafts?.has(lead.id) ?? false
            const isGenerating = generatingLeadId === lead.id

            return (
              <tr
                key={lead.id}
                className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]"
              >
                <td className="py-3 px-4">
                  <div className="text-[var(--text-primary)] font-medium">
                    {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '\u2014'}
                  </div>
                  <div className="text-[var(--text-muted)] text-xs">{lead.email}</div>
                </td>
                <td className="py-3 px-4 text-[var(--text-secondary)]">{lead.company ?? '\u2014'}</td>
                <td className="py-3 px-4 text-[var(--text-secondary)]">{lead.title ?? '\u2014'}</td>
                <td className="py-3 px-4"><StatusBadge status={lead.status} /></td>
                <td className="py-3 px-4"><ScoreBadge score={lead.score} /></td>
                <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden lg:table-cell max-w-xs truncate">
                  {lead.scoreReason ?? '\u2014'}
                </td>
                {showActions && (
                  <td className="py-3 px-4">
                    {hasPendingDraft ? (
                      <button
                        onClick={() => onReviewDraft?.(lead.id)}
                        className="text-xs text-[var(--accent-indigo)] hover:text-[var(--accent-indigo-hover)] transition-colors font-medium"
                      >
                        Review Draft
                      </button>
                    ) : (
                      <button
                        onClick={() => void onGenerateDraft?.(lead.id)}
                        disabled={isGenerating}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-50 transition-colors"
                      >
                        {isGenerating ? 'Generating\u2026' : 'Generate Draft'}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
