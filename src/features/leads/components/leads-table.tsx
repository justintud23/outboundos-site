import { Badge } from '@/components/ui/badge'
import type { LeadDTO } from '../types'

interface LeadsTableProps {
  leads: LeadDTO[]
}

function ScoreBadge({ score }: { score: number | null }) {
  if (score === null) return <span className="text-[#475569] text-xs">—</span>
  const variant =
    score >= 70 ? 'success' : score >= 40 ? 'warning' : 'danger'
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
  }
  return <Badge variant={variantMap[status]}>{status}</Badge>
}

export function LeadsTable({ leads }: LeadsTableProps) {
  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[#475569] text-sm">No leads yet.</p>
        <p className="text-[#334155] text-xs mt-1">Import a CSV to get started.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e2130]">
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Name</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Company</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Title</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Score</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Score Reason</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr
              key={lead.id}
              className="border-b border-[#1a1d2e] hover:bg-[#1a1d2e] transition-colors"
            >
              <td className="py-3 px-4">
                <div className="text-[#e2e8f0] font-medium">
                  {[lead.firstName, lead.lastName].filter(Boolean).join(' ') || '—'}
                </div>
                <div className="text-[#475569] text-xs">{lead.email}</div>
              </td>
              <td className="py-3 px-4 text-[#94a3b8]">{lead.company ?? '—'}</td>
              <td className="py-3 px-4 text-[#94a3b8]">{lead.title ?? '—'}</td>
              <td className="py-3 px-4"><StatusBadge status={lead.status} /></td>
              <td className="py-3 px-4"><ScoreBadge score={lead.score} /></td>
              <td className="py-3 px-4 text-[#475569] text-xs hidden lg:table-cell max-w-xs truncate">
                {lead.scoreReason ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
