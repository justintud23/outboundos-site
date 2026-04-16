import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Users, FileUp } from 'lucide-react'
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
  return <Badge variant={variant} showIcon>{score}</Badge>
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
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-[var(--bg-surface-raised)] flex items-center justify-center">
          <Users size={24} className="text-[var(--text-muted)]" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[var(--text-secondary)] text-sm font-medium">No leads yet</p>
          <p className="text-[var(--text-muted)] text-xs mt-1">Import a CSV to get started</p>
        </div>
        <div className="flex items-center gap-1.5 text-[var(--accent-indigo)] text-xs mt-1">
          <FileUp size={14} aria-hidden="true" />
          <span>Upload CSV</span>
        </div>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]/60">
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wider">Name</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wider">Company</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wider">Title</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wider">Status</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wider">Score</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wider hidden lg:table-cell">Score Reason</th>
            {showActions && (
              <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wider">Actions</th>
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
                className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)] group"
              >
                <td className="py-3 px-4">
                  <Link href={`/leads/${lead.id}`} className="block group/name">
                    <div className="text-[var(--text-primary)] font-medium group-hover/name:text-[var(--accent-indigo)] transition-colors">
                      {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '\u2014'}
                    </div>
                    <div className="text-[var(--text-muted)] text-xs">{lead.email}</div>
                  </Link>
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
                        className="text-xs text-[var(--accent-indigo)] hover:text-[var(--accent-indigo-hover)] transition-colors font-medium cursor-pointer"
                      >
                        Review Draft
                      </button>
                    ) : (
                      <button
                        onClick={() => void onGenerateDraft?.(lead.id)}
                        disabled={isGenerating}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
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
