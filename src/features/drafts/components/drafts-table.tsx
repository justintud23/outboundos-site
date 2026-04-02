import { Badge } from '@/components/ui/badge'
import type { DraftDTO, DraftWithLeadDTO } from '@/features/drafts/types'

interface DraftsTableProps {
  drafts: DraftWithLeadDTO[]
  onReview: (draft: DraftWithLeadDTO) => void
}

export function DraftsTable({ drafts, onReview }: DraftsTableProps) {
  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[#94a3b8] text-sm">No drafts pending review</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e2130]">
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Lead</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Subject</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide hidden md:table-cell">Created</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => (
            <tr key={draft.id} className="border-b border-[#1e2130] hover:bg-[#1a1d2e] transition-colors">
              <td className="px-4 py-3">
                <div className="text-[#e2e8f0]">
                  {[draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') || draft.lead.email}
                </div>
                <div className="text-[#94a3b8] text-xs">{draft.lead.email}</div>
              </td>
              <td className="px-4 py-3">
                <span className="text-[#e2e8f0] truncate block max-w-[200px]">{draft.subject}</span>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={draft.status} />
              </td>
              <td className="px-4 py-3 text-[#94a3b8] hidden md:table-cell">
                {new Date(draft.createdAt).toLocaleDateString('en-US')}
              </td>
              <td className="px-4 py-3">
                {draft.status === 'PENDING_REVIEW' && (
                  <button
                    onClick={() => onReview(draft)}
                    aria-label={`Review draft for ${[draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') || draft.lead.email}`}
                    className="text-xs px-3 py-1 rounded bg-[#1e2130] hover:bg-[#6366f1] text-[#e2e8f0] transition-colors"
                  >
                    Review
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function StatusBadge({ status }: { status: DraftDTO['status'] }) {
  if (status === 'PENDING_REVIEW') {
    return <Badge variant="muted">Pending</Badge>
  }
  if (status === 'APPROVED') {
    return <Badge variant="success">Approved</Badge>
  }
  // REJECTED
  return <Badge variant="danger">Rejected</Badge>
}
