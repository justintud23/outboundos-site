'use client'

import { useState, useCallback } from 'react'
import { PipelineBoard } from '@/features/leads/components/pipeline-board'
import type { PipelineLeadDTO } from '@/features/leads/types'
import type { LeadStatus } from '@prisma/client'

interface PipelineClientProps {
  initialLeads: PipelineLeadDTO[]
}

export function PipelineClient({ initialLeads }: PipelineClientProps) {
  const [leads, setLeads] = useState<PipelineLeadDTO[]>(initialLeads)
  const [error, setError] = useState<string | null>(null)

  const handleStatusChange = useCallback(
    async (leadId: string, newStatus: LeadStatus) => {
      // Optimistic update
      const previousLeads = leads
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l)),
      )
      setError(null)

      try {
        const res = await fetch(`/api/leads/${leadId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        })

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          throw new Error(data?.error ?? 'Failed to update status')
        }
      } catch (err) {
        // Revert optimistic update
        setLeads(previousLeads)
        setError(err instanceof Error ? err.message : 'Failed to update status')
      }
    },
    [leads],
  )

  return (
    <div className="space-y-4 h-full">
      {error && (
        <div className="text-[var(--status-danger)] text-sm bg-[var(--status-danger-bg)] border border-[var(--status-danger)]/30 rounded-[var(--radius-btn)] px-4 py-2">
          {error}
        </div>
      )}
      <PipelineBoard leads={leads} onStatusChange={handleStatusChange} />
    </div>
  )
}
