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
          <div className="flex items-center justify-between bg-[#2d1f00] border border-[#f59e0b]/30 rounded-lg px-4 py-3">
            <p className="text-[#f59e0b] text-sm font-medium">
              {pendingCount} draft{pendingCount !== 1 ? 's' : ''} pending review
            </p>
            <button
              onClick={() => setFilter('pending')}
              className="text-[#f59e0b] text-xs underline hover:no-underline transition-all"
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
          <div className="text-[#ef4444] text-sm bg-[#2d0f0f] border border-[#7f1d1d] rounded px-4 py-2">
            {sendError}
          </div>
        )}

        <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
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
        'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors',
        active
          ? 'bg-[#1e2130] text-[#e2e8f0]'
          : 'text-[#475569] hover:text-[#94a3b8]',
      ].join(' ')}
    >
      {label}
      <span
        className={[
          'inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full text-xs px-1',
          active
            ? highlight
              ? 'bg-[#f59e0b] text-[#0f1117]'
              : 'bg-[#2d3148] text-[#94a3b8]'
            : highlight
              ? 'bg-[#f59e0b]/20 text-[#f59e0b]'
              : 'bg-[#1a1d2e] text-[#475569]',
        ].join(' ')}
      >
        {count}
      </span>
    </button>
  )
}
