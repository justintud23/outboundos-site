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

  function handleReview(draft: DraftWithLeadDTO) {
    setReviewingDraft(draft)
  }

  function handleDraftReviewed(updatedDraft: DraftDTO) {
    setDrafts((prev) => prev.filter((d) => d.id !== updatedDraft.id))
    if (updatedDraft.status !== 'PENDING_REVIEW') {
      setTotal((prev) => Math.max(0, prev - 1))
    }
    setReviewingDraft(null)
  }

  return (
    <>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <span className="text-[#94a3b8] text-sm">
            {total.toLocaleString()} draft{total !== 1 ? 's' : ''} pending review
          </span>
        </div>

        <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
          <DraftsTable drafts={drafts} onReview={handleReview} />
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
