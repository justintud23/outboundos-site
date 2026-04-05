'use client'

import { useState } from 'react'
import { CsvUploadForm } from '@/features/leads/components/csv-upload-form'
import { LeadsTable } from '@/features/leads/components/leads-table'
import { DraftReviewDrawer } from '@/features/drafts/components/draft-review-drawer'
import type { LeadDTO, ImportBatchResult } from '@/features/leads/types'
import type { DraftDTO, DraftWithLeadDTO } from '@/features/drafts/types'

interface LeadsPageClientProps {
  initialLeads: LeadDTO[]
  initialTotal: number
}

export function LeadsPageClient({ initialLeads, initialTotal }: LeadsPageClientProps) {
  const [leads, setLeads] = useState<LeadDTO[]>(initialLeads)
  const [total, setTotal] = useState(initialTotal)
  const [lastBatch, setLastBatch] = useState<ImportBatchResult['batch'] | null>(null)

  // Draft state: map of leadId → DraftWithLeadDTO for leads with a pending draft
  const [draftsByLeadId, setDraftsByLeadId] = useState<Map<string, DraftWithLeadDTO>>(new Map())
  const [reviewingDraft, setReviewingDraft] = useState<DraftWithLeadDTO | null>(null)
  const [generatingLeadId, setGeneratingLeadId] = useState<string | null>(null)
  const [generationError, setGenerationError] = useState<string | null>(null)

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

  function buildDraftWithLead(draft: DraftDTO, leadId: string): DraftWithLeadDTO {
    const lead = leads.find((l) => l.id === leadId)
    return {
      ...draft,
      lead: {
        id: lead?.id ?? leadId,
        email: lead?.email ?? '',
        firstName: lead?.firstName ?? null,
        lastName: lead?.lastName ?? null,
        company: lead?.company ?? null,
      },
    }
  }

  async function handleGenerateDraft(leadId: string) {
    setGeneratingLeadId(leadId)
    setGenerationError(null)
    try {
      const res = await fetch('/api/drafts/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId }),
      })

      // Parse body once — stream can only be consumed once
      const data = await res.json().catch(() => null) as
        | DraftDTO
        | { code: string; draftId: string; message: string }
        | { error?: string }
        | null

      if (res.status === 409 && data && 'code' in data && data.code === 'PENDING_DRAFT_EXISTS') {
        // Already has a pending draft — update map with minimal placeholder so Review button appears
        const placeholderDto: DraftDTO = {
          id: (data as { code: string; draftId: string; message: string }).draftId,
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
        }
        setDraftsByLeadId((prev) => new Map(prev).set(leadId, buildDraftWithLead(placeholderDto, leadId)))
        return
      }

      if (!res.ok) {
        const errData = data as { error?: string } | null
        setGenerationError(errData?.error ?? 'Failed to generate draft. Please try again.')
        return
      }

      const draft = buildDraftWithLead(data as DraftDTO, leadId)
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
    setDraftsByLeadId((prev) => new Map(prev).set(updatedDraft.leadId, buildDraftWithLead(updatedDraft, updatedDraft.leadId)))
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
            {generationError && (
              <span className="text-[#ef4444] text-xs">{generationError}</span>
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
