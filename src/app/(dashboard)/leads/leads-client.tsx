'use client'

import { useState } from 'react'
import { CsvUploadForm } from '@/features/leads/components/csv-upload-form'
import { LeadsTable } from '@/features/leads/components/leads-table'
import { DraftReviewDrawer } from '@/features/drafts/components/draft-review-drawer'
import type { LeadDTO, ImportBatchResult } from '@/features/leads/types'
import type { DraftDTO } from '@/features/drafts/types'

interface LeadsPageClientProps {
  initialLeads: LeadDTO[]
  initialTotal: number
}

export function LeadsPageClient({ initialLeads, initialTotal }: LeadsPageClientProps) {
  const [leads, setLeads] = useState<LeadDTO[]>(initialLeads)
  const [total, setTotal] = useState(initialTotal)
  const [lastBatch, setLastBatch] = useState<ImportBatchResult['batch'] | null>(null)

  // Draft state: map of leadId → DraftDTO for leads with a pending draft
  const [draftsByLeadId, setDraftsByLeadId] = useState<Map<string, DraftDTO>>(new Map())
  const [reviewingDraft, setReviewingDraft] = useState<DraftDTO | null>(null)
  const [generatingLeadId, setGeneratingLeadId] = useState<string | null>(null)

  // pendingDrafts: leadId → draftId (passed to table for display logic)
  const pendingDrafts = new Map(
    [...draftsByLeadId.entries()]
      .filter(([, d]) => d.status === 'PENDING_REVIEW')
      .map(([leadId, d]) => [leadId, d.id]),
  )

  function handleImportSuccess(result: ImportBatchResult) {
    setLeads((prev) => {
      const existingIds = new Set(prev.map((l) => l.id))
      const newLeads = result.leads.filter((l) => !existingIds.has(l.id))
      return [...newLeads, ...prev]
    })
    setTotal((prev) => prev + result.batch.successCount)
    setLastBatch(result.batch)
  }

  async function handleGenerateDraft(leadId: string) {
    setGeneratingLeadId(leadId)
    try {
      const res = await fetch('/api/drafts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })

      const data = (await res.json()) as
        | DraftDTO
        | { code: string; draftId: string; message: string }

      if (res.status === 409 && 'code' in data && data.code === 'PENDING_DRAFT_EXISTS') {
        // Already has a pending draft — update map with minimal placeholder so Review button appears
        setDraftsByLeadId((prev) => {
          const next = new Map(prev)
          next.set(leadId, {
            id: data.draftId,
            organizationId: '',
            leadId,
            subject: '',
            body: '',
            status: 'PENDING_REVIEW',
            promptTemplateId: null,
            createdByClerkId: null,
            approvedByClerkId: null,
            approvedAt: null,
            rejectedAt: null,
            rejectionReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          } as DraftDTO)
          return next
        })
        return
      }

      if (!res.ok) return

      const draft = data as DraftDTO
      setDraftsByLeadId((prev) => new Map(prev).set(leadId, draft))
      setReviewingDraft(draft)
    } finally {
      setGeneratingLeadId(null)
    }
  }

  function handleReviewDraft(leadId: string) {
    const draft = draftsByLeadId.get(leadId)
    if (draft) setReviewingDraft(draft)
  }

  function handleDraftReviewed(updatedDraft: DraftDTO) {
    // Update the map — draft is no longer PENDING_REVIEW so it won't appear in pendingDrafts
    setDraftsByLeadId((prev) => {
      const next = new Map(prev)
      next.set(updatedDraft.leadId, updatedDraft)
      return next
    })
    setReviewingDraft(null)
  }

  return (
    <>
      <div className="space-y-6">
        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-[#94a3b8] text-sm">
              {total.toLocaleString()} lead{total !== 1 ? 's' : ''}
            </span>
            {lastBatch && (
              <span className="text-[#10b981] text-xs">
                + {lastBatch.successCount} imported
              </span>
            )}
          </div>
          <CsvUploadForm onSuccess={handleImportSuccess} />
        </div>

        {/* Table */}
        <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
          <LeadsTable
            leads={leads}
            pendingDrafts={pendingDrafts}
            onGenerateDraft={handleGenerateDraft}
            onReviewDraft={handleReviewDraft}
            generatingLeadId={generatingLeadId}
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
