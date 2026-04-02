import type { DraftWithLeadDTO } from '@/features/drafts/types'

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
            <th className="text-left px-4 py-3 text-[#94a3b8] font-medium">Lead</th>
            <th className="text-left px-4 py-3 text-[#94a3b8] font-medium">Subject</th>
            <th className="text-left px-4 py-3 text-[#94a3b8] font-medium">Status</th>
            <th className="text-left px-4 py-3 text-[#94a3b8] font-medium hidden md:table-cell">Created</th>
            <th className="text-left px-4 py-3 text-[#94a3b8] font-medium">Actions</th>
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
                {new Date(draft.createdAt).toLocaleDateString()}
              </td>
              <td className="px-4 py-3">
                {draft.status === 'PENDING_REVIEW' && (
                  <button
                    onClick={() => onReview(draft)}
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

function StatusBadge({ status }: { status: string }) {
  if (status === 'PENDING_REVIEW') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-[#1e2130] text-[#94a3b8]">Pending</span>
  }
  if (status === 'APPROVED') {
    return <span className="text-xs px-2 py-0.5 rounded-full bg-[#1e3a2e] text-[#4ade80]">Approved</span>
  }
  return <span className="text-xs px-2 py-0.5 rounded-full bg-[#2e1e1e] text-[#f87171]">Rejected</span>
}
