'use client'

import { useState, useEffect, useRef } from 'react'
import type { DraftDTO, DraftWithLeadDTO } from '../types'

interface DraftReviewDrawerProps {
  draft: DraftWithLeadDTO | null  // null = closed
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
  const abortRef = useRef<AbortController | null>(null)

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

  // Escape key closes the drawer
  useEffect(() => {
    if (!draft) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [draft, submitting, onClose])

  // Cancel in-flight request on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  if (!draft) return null

  const leadName =
    [draft.lead.firstName, draft.lead.lastName].filter(Boolean).join(' ') ||
    draft.lead.email

  async function handleApprove() {
    if (!draft) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
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
        signal: controller.signal,
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string }
        setError(data.message ?? data.error ?? 'Failed to approve draft')
        return
      }
      const updated = (await res.json()) as DraftDTO
      onReviewed(updated)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleReject() {
    if (!draft) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
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
        signal: controller.signal,
      })
      if (!res.ok) {
        const data = (await res.json()) as { message?: string; error?: string }
        setError(data.message ?? data.error ?? 'Failed to reject draft')
        return
      }
      const updated = (await res.json()) as DraftDTO
      onReviewed(updated)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={submitting ? undefined : onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-review-title"
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-[var(--bg-base)] border-l border-[var(--border-default)] z-50 flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h2 id="draft-review-title" className="text-[var(--text-primary)] font-semibold text-sm">
            Review Draft
          </h2>
          <button
            onClick={submitting ? undefined : onClose}
            disabled={submitting}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors duration-[var(--transition-base)] text-lg leading-none disabled:opacity-50"
            aria-label="Close"
          >
            {'\u2715'}
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">

          {/* Lead context panel */}
          <div className="px-5 py-4 bg-[var(--bg-surface)] border-b border-[var(--border-default)]">
            <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide font-medium mb-2">To</p>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[var(--text-primary)] text-sm font-medium">{leadName}</p>
                {leadName !== draft.lead.email && (
                  <p className="text-[var(--text-secondary)] text-xs mt-0.5">{draft.lead.email}</p>
                )}
                {draft.lead.company && (
                  <p className="text-[var(--text-muted)] text-xs mt-0.5">{draft.lead.company}</p>
                )}
              </div>
              {draft.promptTemplateId && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-badge)] text-xs font-medium bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)]">
                  ✦ AI Generated
                </span>
              )}
            </div>
          </div>

          {/* Editable email content */}
          <div className="px-5 py-4 space-y-4">
            <div>
              <label
                htmlFor="draft-subject"
                className="block text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide mb-1"
              >
                Subject
              </label>
              <input
                id="draft-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] transition-colors duration-[var(--transition-base)]"
                disabled={submitting}
              />
            </div>

            <div>
              <label
                htmlFor="draft-body"
                className="block text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide mb-1"
              >
                Body
              </label>
              <textarea
                id="draft-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] resize-none font-mono leading-relaxed transition-colors duration-[var(--transition-base)]"
                disabled={submitting}
              />
              {(subject !== draft.subject || body !== draft.body) && (
                <p className="text-[var(--status-warning)] text-xs mt-1">Edited — will save on approve</p>
              )}
            </div>

            {showRejectInput && (
              <div>
                <label
                  htmlFor="draft-rejection-reason"
                  className="block text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide mb-1"
                >
                  Rejection reason (optional)
                </label>
                <input
                  id="draft-rejection-reason"
                  type="text"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Wrong tone, needs revision"
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] px-3 py-2 text-[var(--text-primary)] text-sm focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] transition-colors duration-[var(--transition-base)]"
                  disabled={submitting}
                  autoFocus
                />
              </div>
            )}

            {error && (
              <p className="text-[var(--status-danger)] text-sm bg-[var(--status-danger-bg)] border border-[var(--status-danger)]/30 rounded-[var(--radius-btn)] px-3 py-2">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-[var(--border-default)] flex gap-2">
          {!showRejectInput ? (
            <>
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="flex-1 bg-[var(--accent-indigo)] hover:bg-[var(--accent-indigo-hover)] disabled:opacity-50 text-white rounded-[var(--radius-btn)] px-4 py-2 text-sm font-medium transition-colors duration-[var(--transition-base)]"
              >
                {submitting ? 'Approving…' : 'Approve'}
              </button>
              <button
                onClick={() => setShowRejectInput(true)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-[var(--status-danger)] border border-[var(--status-danger)]/40 rounded-[var(--radius-btn)] hover:bg-[var(--status-danger-bg)] disabled:opacity-50 transition-colors duration-[var(--transition-base)]"
              >
                Reject
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleReject}
                disabled={submitting}
                className="flex-1 bg-[var(--status-danger)] hover:brightness-110 disabled:opacity-50 text-white rounded-[var(--radius-btn)] px-4 py-2 text-sm font-medium transition-colors duration-[var(--transition-base)]"
              >
                {submitting ? 'Rejecting…' : 'Confirm Reject'}
              </button>
              <button
                onClick={() => setShowRejectInput(false)}
                disabled={submitting}
                className="px-4 py-2 text-sm text-[var(--text-muted)] border border-[var(--border-default)] rounded-[var(--radius-btn)] hover:bg-[var(--bg-surface-raised)] disabled:opacity-50 transition-colors duration-[var(--transition-base)]"
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
