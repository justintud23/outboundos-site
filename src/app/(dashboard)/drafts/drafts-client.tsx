'use client'

import { useState } from 'react'
import { DraftsTable } from '@/features/drafts/components/drafts-table'
import { DraftReviewDrawer } from '@/features/drafts/components/draft-review-drawer'
import type { DraftWithLeadDTO, DraftDTO } from '@/features/drafts/types'

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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <span className="text-[#94a3b8] text-sm">
            {total.toLocaleString()} draft{total !== 1 ? 's' : ''}
          </span>
        </div>

        {sendError && (
          <div className="text-[#ef4444] text-sm bg-[#2d0f0f] border border-[#7f1d1d] rounded px-4 py-2">
            {sendError}
          </div>
        )}

        <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
          <DraftsTable
            drafts={drafts}
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
