'use client'

import { useState, useMemo } from 'react'
import { DraftsTable } from '@/features/drafts/components/drafts-table'
import { DraftReviewDrawer } from '@/features/drafts/components/draft-review-drawer'
import type { DraftWithLeadDTO, DraftDTO } from '@/features/drafts/types'

type StatusFilter = 'all' | 'pending' | 'approved'

interface DraftsClientProps {
  initialDrafts: DraftWithLeadDTO[]
  initialTotal: number
}

export function DraftsClient({ initialDrafts, initialTotal }: DraftsClientProps) {
  const [drafts, setDrafts] = useState<DraftWithLeadDTO[]>(initialDrafts)
  const [total, setTotal] = useState(initialTotal)
  const [reviewingDraft, setReviewingDraft] = useState<DraftWithLeadDTO | null>(null)
  const [sendingDraftId, setSendingDraftId] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [filter, setFilter] = useState<StatusFilter>('all')

  const pendingCount  = useMemo(() => drafts.filter((d) => d.status === 'PENDING_REVIEW').length, [drafts])
  const approvedCount = useMemo(() => drafts.filter((d) => d.status === 'APPROVED').length, [drafts])

  const visibleDrafts = useMemo(() => {
    if (filter === 'pending')  return drafts.filter((d) => d.status === 'PENDING_REVIEW')
    if (filter === 'approved') return drafts.filter((d) => d.status === 'APPROVED')
    return drafts
  }, [drafts, filter])

  function handleReview(draft: DraftWithLeadDTO) {
    setSendError(null)
    setReviewingDraft(draft)
  }

  function handleDraftReviewed(updatedDraft: DraftDTO) {
    if (updatedDraft.status === 'APPROVED') {
      // Keep in list — approved drafts stay visible so the user can send them
      setDrafts((prev) =>
        prev.map((d) => (d.id === updatedDraft.id ? { ...d, ...updatedDraft } : d)),
      )
    } else {
      // Rejected: remove from list and decrement count
      setDrafts((prev) => prev.filter((d) => d.id !== updatedDraft.id))
      setTotal((prev) => Math.max(0, prev - 1))
    }
    setReviewingDraft(null)
  }

  async function handleSend(draft: DraftWithLeadDTO) {
    setSendingDraftId(draft.id)
    setSendError(null)

    const res = await fetch(`/api/drafts/${draft.id}/send`, { method: 'POST' })
    const data = await res.json().catch(() => null)

    setSendingDraftId(null)

    if (!res.ok) {
      const message =
        data?.code === 'MAILBOX_LIMIT_EXCEEDED'
          ? 'Daily send limit reached. Try again tomorrow.'
          : data?.code === 'NO_ACTIVE_MAILBOX'
            ? 'No active mailbox configured. Add a mailbox in Settings.'
            : data?.code === 'DRAFT_ALREADY_SENT'
              ? 'This draft has already been sent.'
              : (data?.error ?? 'Failed to send — please try again.')
      setSendError(message)
      return
    }

    // Remove sent draft from the list
    setDrafts((prev) => prev.filter((d) => d.id !== draft.id))
    setTotal((prev) => Math.max(0, prev - 1))
  }

  return (
    <>
      <div className="space-y-4">

        {/* Pending CTA banner */}
        {pendingCount > 0 && (
          <div className="flex items-center justify-between bg-[var(--status-warning-bg)] border border-[var(--status-warning)]/30 rounded-[var(--radius-card)] px-4 py-3">
            <p className="text-[var(--status-warning)] text-sm font-medium">
              {pendingCount} draft{pendingCount !== 1 ? 's' : ''} pending review
            </p>
            <button
              onClick={() => setFilter('pending')}
              className="text-[var(--status-warning)] text-xs underline hover:no-underline transition-all duration-[var(--transition-base)]"
            >
              Review now →
            </button>
          </div>
        )}

        {/* Filter tabs + count */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1">
            <TabButton
              active={filter === 'all'}
              onClick={() => setFilter('all')}
              label="All"
              count={total}
            />
            <TabButton
              active={filter === 'pending'}
              onClick={() => setFilter('pending')}
              label="Pending"
              count={pendingCount}
              highlight={pendingCount > 0}
            />
            <TabButton
              active={filter === 'approved'}
              onClick={() => setFilter('approved')}
              label="Approved"
              count={approvedCount}
            />
          </div>
        </div>

        {sendError && (
          <div className="text-[var(--status-danger)] text-sm bg-[var(--status-danger-bg)] border border-[var(--status-danger)]/30 rounded-[var(--radius-btn)] px-4 py-2">
            {sendError}
          </div>
        )}

        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
          <DraftsTable
            drafts={visibleDrafts}
            onReview={handleReview}
            onSend={handleSend}
            sendingDraftId={sendingDraftId}
          />
        </div>
      </div>

      <DraftReviewDrawer
        draft={reviewingDraft}
        onClose={() => setReviewingDraft(null)}
        onReviewed={handleDraftReviewed}
      />
    </>
  )
}

// ─── Tab button ────────────────────────────────────────────────────────────────

interface TabButtonProps {
  active: boolean
  onClick: () => void
  label: string
  count: number
  highlight?: boolean
}

function TabButton({ active, onClick, label, count, highlight }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-btn)] text-xs font-medium transition-colors duration-[var(--transition-base)]',
        active
          ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]'
          : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
      ].join(' ')}
    >
      {label}
      <span
        className={[
          'inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-xs px-1',
          active
            ? highlight
              ? 'bg-[var(--status-warning)] text-[var(--text-inverse)]'
              : 'bg-[var(--bg-surface-overlay)] text-[var(--text-secondary)]'
            : highlight
              ? 'bg-[var(--status-warning-bg)] text-[var(--status-warning)]'
              : 'bg-[var(--bg-surface-raised)] text-[var(--text-muted)]',
        ].join(' ')}
      >
        {count}
      </span>
    </button>
  )
}
