import { Badge } from '@/components/ui/badge'
import type { DraftDTO, DraftWithLeadDTO } from '@/features/drafts/types'
import { RetrySendButton } from '@/features/messages/components/retry-send-button'

interface DraftsTableProps {
  drafts: DraftWithLeadDTO[]
  onReview: (draft: DraftWithLeadDTO) => void
  onSend?: (draft: DraftWithLeadDTO) => Promise<void>
  sendingDraftId?: string | null
}

export function DraftsTable({ drafts, onReview, onSend, sendingDraftId }: DraftsTableProps) {
  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[var(--text-secondary)] text-sm">No drafts to review.</p>
        <p className="text-[var(--text-muted)] text-xs mt-1">Generate drafts from a campaign to get started.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]/60">
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Lead</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Subject</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden md:table-cell">Created</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {drafts.map((draft) => {
            const displayName =
              [draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') ||
              draft.lead.email
            const isSending = sendingDraftId === draft.id

            return (
              <tr key={draft.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]">
                <td className="px-4 py-3">
                  <div className="text-[var(--text-primary)]">{displayName}</div>
                  <div className="text-[var(--text-secondary)] text-xs">{draft.lead.email}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-[var(--text-primary)] truncate block max-w-[200px]">{draft.subject}</span>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={draft.status} guardrailFlags={draft.guardrailFlags} />
                </td>
                <td className="px-4 py-3 text-[var(--text-secondary)] hidden md:table-cell">
                  {new Date(draft.createdAt).toLocaleDateString('en-US')}
                </td>
                <td className="px-4 py-3">
                  {(draft.status === 'PENDING_REVIEW' || draft.status === 'BLOCKED') && (
                    <button
                      onClick={() => onReview(draft)}
                      aria-label={`Review draft for ${displayName}`}
                      className="text-xs px-3 py-1 rounded-[var(--radius-btn)] bg-[var(--bg-surface-raised)] hover:bg-[var(--accent-indigo)] text-[var(--text-primary)] transition-colors duration-[var(--transition-base)] cursor-pointer"
                    >
                      Review
                    </button>
                  )}
                  {draft.outboundMessage && <SendState message={draft.outboundMessage} />}
                  {draft.status === 'APPROVED' && onSend && !draft.outboundMessage && (
                    <button
                      onClick={() => void onSend(draft)}
                      disabled={isSending}
                      aria-label={`Send draft to ${displayName}`}
                      className="text-xs px-3 py-1 rounded-[var(--radius-btn)] bg-[var(--status-success-bg)] hover:bg-[var(--status-success)]/25 text-[var(--status-success)] transition-colors duration-[var(--transition-base)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSending ? 'Sending…' : 'Send'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// A draft with an OutboundMessage belongs to a send (usually the automatic
// queue) — show where it stands instead of a manual Send.
function SendState({ message }: { message: NonNullable<DraftWithLeadDTO['outboundMessage']> }) {
  if (message.status === 'QUEUED') {
    return <span className="text-[var(--text-muted)] text-xs">Queued to send</span>
  }
  if (message.status === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-[var(--status-danger)] text-xs">Send failed</span>
        <RetrySendButton messageId={message.id} />
      </span>
    )
  }
  if (message.status === 'CANCELLED') {
    return <span className="text-[var(--text-muted)] text-xs">Cancelled</span>
  }
  return <span className="text-[var(--text-muted)] text-xs">Sent</span>
}

function StatusBadge({
  status,
  guardrailFlags,
}: {
  status: DraftDTO['status']
  guardrailFlags?: { rule: string; match: string }[] | null
}) {
  if (status === 'PENDING_REVIEW') {
    return <Badge variant="warning">Pending Review</Badge>
  }
  if (status === 'APPROVED') {
    return <Badge variant="success">Approved</Badge>
  }
  if (status === 'BLOCKED') {
    const flagText = (guardrailFlags ?? [])
      .map((f) => `${f.rule.toLowerCase().replace(/_/g, ' ')} (${f.match})`)
      .join(', ')
    return (
      <div className="space-y-0.5">
        <Badge variant="danger">Blocked</Badge>
        {flagText && <p className="text-[var(--status-danger)] text-xs opacity-80">{flagText}</p>}
      </div>
    )
  }
  // REJECTED
  return <Badge variant="danger">Rejected</Badge>
}
