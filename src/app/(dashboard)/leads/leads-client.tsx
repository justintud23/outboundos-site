'use client'

import { useState } from 'react'
import { CsvUploadForm } from '@/features/leads/components/csv-upload-form'
import { LeadsTable } from '@/features/leads/components/leads-table'
import type { LeadDTO, ImportBatchResult } from '@/features/leads/types'

interface LeadsPageClientProps {
  initialLeads: LeadDTO[]
  initialTotal: number
}

export function LeadsPageClient({ initialLeads, initialTotal }: LeadsPageClientProps) {
  const [leads, setLeads] = useState<LeadDTO[]>(initialLeads)
  const [total, setTotal] = useState(initialTotal)
  const [lastBatch, setLastBatch] = useState<ImportBatchResult['batch'] | null>(null)

  function handleImportSuccess(result: ImportBatchResult) {
    // Prepend new leads, keeping list fresh without a full page reload
    setLeads((prev) => {
      const existingIds = new Set(prev.map((l) => l.id))
      const newLeads = result.leads.filter((l) => !existingIds.has(l.id))
      return [...newLeads, ...prev]
    })
    setTotal((prev) => prev + result.batch.successCount)
    setLastBatch(result.batch)
  }

  return (
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
        <LeadsTable leads={leads} />
      </div>
    </div>
  )
}
