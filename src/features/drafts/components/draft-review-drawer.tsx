'use client'

import { useState, useEffect } from 'react'
import type { DraftDTO } from '../types'

interface DraftReviewDrawerProps {
  draft: DraftDTO | null  // null = closed
  onClose: () => void
  onReviewed: (draft: DraftDTO) => void
}

export function DraftReviewDrawer({ draft, onClose, onReviewed }: DraftReviewDrawerProps) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [showRejectInput, setShowRejectInput] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form state when a new draft is opened
  useEffect(() => {
    if (draft) {
      setSubject(draft.subject)
      setBody(draft.body)
      setShowRejectInput(false)
      setRejectionReason('')
      setError(null)
    }
  }, [draft?.id])

  if (!draft) return null

  async function handleApprove() {
    if (!draft) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/drafts/${draft.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          subject: subject !== draft.subject ? subject : undefined,
          body: body !== draft.body ? body : undefined,
        }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string }
        setError(data.message ?? data.error ?? 'Failed to approve draft')
        return
      }
      const updated = (await res.json()) as DraftDTO
      onReviewed(updated)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReject() {
    if (!draft) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/drafts/${draft.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reject',
          rejectionReason: rejectionReason || undefined,
        }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string }
        setError(data.message ?? data.error ?? 'Failed to reject draft')
        return
      }
      const updated = (await res.json()) as DraftDTO
      onReviewed(updated)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-[#13151c] border-l border-[#1e2130] z-50 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#1e2130]">
          <h2 className="text-[#e2e8f0] font-semibold">Review Draft</h2>
          <button
            onClick={onClose}
            className="text-[#475569] hover:text-[#94a3b8] transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <label className="block text-[#475569] text-xs font-medium uppercase tracking-wide mb-1">
              Subject
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full bg-[#1a1d2e] border border-[#1e2130] rounded px-3 py-2 text-[#e2e8f0] text-sm focus:outline-none focus:border-[#6366f1]"
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-[#475569] text-xs font-medium uppercase tracking-wide mb-1">
              Body
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={14}
              className="w-full bg-[#1a1d2e] border border-[#1e2130] rounded px-3 py-2 text-[#e2e8f0] text-sm focus:outline-none focus:border-[#6366f1] resize-none"
              disabled={submitting}
            />
          </div>

          {showRejectInput && (
            <div>
              <label className="block text-[#475569] text-xs font-medium uppercase tracking-wide mb-1">
                Rejection reason (optional)
              </label>
              <input
                type="text"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Wrong tone, needs revision"
                className="w-full bg-[#1a1d2e] border border-[#1e2130] rounded px-3 py-2 text-[#e2e8f0] text-sm focus:outline-none focus:border-[#6366f1]"
                disabled={submitting}
              />
            </div>
          )}

          {error && <p className="text-[#ef4444] text-sm">{error}</p>}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#1e2130] flex gap-2">
          {!showRejectInput ? (
            <>
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="flex-1 bg-[#6366f1] hover:bg-[#4f46e5] disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium transition-colors"
              >
                {submitting ? 'Approving…' : 'Approve'}
              </button>
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-[#ef4444] border border-[#ef4444]/40 rounded hover:bg-[#ef4444]/10 disabled:opacity-50 transition-colors"
              >
                Reject
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleReject}
                disabled={submitting}
                className="flex-1 bg-[#ef4444] hover:bg-[#dc2626] disabled:opacity-50 text-white rounded px-4 py-2 text-sm font-medium transition-colors"
              >
                {submitting ? 'Rejecting…' : 'Confirm Reject'}
              </button>
              <button
                onClick={() => setShowRejectInput(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-[#475569] border border-[#1e2130] rounded hover:bg-[#1a1d2e] disabled:opacity-50 transition-colors"
              >
                Back
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}
