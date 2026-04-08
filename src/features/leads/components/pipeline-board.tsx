'use client'

import { useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { PipelineCard } from './pipeline-card'
import { PIPELINE_COLUMNS, TERMINAL_STATUSES } from '../types'
import type { PipelineLeadDTO } from '../types'
import type { LeadStatus } from '@prisma/client'

interface PipelineBoardProps {
  leads: PipelineLeadDTO[]
  onStatusChange: (leadId: string, newStatus: LeadStatus) => Promise<void>
}

const COLUMN_LABELS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  REPLIED: 'Replied',
  INTERESTED: 'Interested',
  CONVERTED: 'Converted',
  NOT_INTERESTED: 'Not Interested',
  UNSUBSCRIBED: 'Unsubscribed',
  BOUNCED: 'Bounced',
}

function DroppableColumn({
  status,
  leads,
}: {
  status: LeadStatus
  leads: PipelineLeadDTO[]
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })

  return (
    <div
      ref={setNodeRef}
      className={[
        'flex flex-col min-w-[220px] w-[220px] flex-shrink-0',
        'bg-[var(--bg-surface-raised)]/50 rounded-[var(--radius-card)] p-3',
        'border border-transparent transition-colors duration-[var(--transition-fast)]',
        isOver ? 'border-[var(--accent-indigo)]/40 bg-[var(--accent-indigo-glow)]/10' : '',
      ].join(' ')}
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wide">
          {COLUMN_LABELS[status] ?? status}
        </h3>
        <span className="text-[var(--text-muted)] text-xs tabular-nums">
          {leads.length}
        </span>
      </div>
      <SortableContext
        items={leads.map((l) => l.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2 min-h-[60px]">
          {leads.map((lead) => (
            <PipelineCard key={lead.id} lead={lead} />
          ))}
        </div>
      </SortableContext>
    </div>
  )
}

export function PipelineBoard({ leads, onStatusChange }: PipelineBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over) return

      const leadId = active.id as string

      // Determine which column was dropped into
      let targetStatus: LeadStatus | null = null

      // Check if dropped on a column directly
      if (
        PIPELINE_COLUMNS.includes(over.id as LeadStatus) ||
        TERMINAL_STATUSES.includes(over.id as LeadStatus)
      ) {
        targetStatus = over.id as LeadStatus
      } else {
        // Dropped on a card — find which column that card belongs to
        const targetLead = leads.find((l) => l.id === over.id)
        if (targetLead) {
          targetStatus = targetLead.status
        }
      }

      if (!targetStatus) return

      // Find source lead's current status
      const sourceLead = leads.find((l) => l.id === leadId)
      if (!sourceLead || sourceLead.status === targetStatus) return

      void onStatusChange(leadId, targetStatus)
    },
    [leads, onStatusChange],
  )

  // Group leads by status
  const grouped = new Map<LeadStatus, PipelineLeadDTO[]>()
  for (const status of [...PIPELINE_COLUMNS, ...TERMINAL_STATUSES]) {
    grouped.set(status, [])
  }
  for (const lead of leads) {
    const group = grouped.get(lead.status)
    if (group) {
      group.push(lead)
    }
  }

  // Sort each group by lastActivityAt DESC
  for (const group of grouped.values()) {
    group.sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() -
        new Date(a.lastActivityAt).getTime(),
    )
  }

  const exitedLeads = TERMINAL_STATUSES.flatMap(
    (s) => grouped.get(s) ?? [],
  )

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {PIPELINE_COLUMNS.map((status) => (
          <DroppableColumn
            key={status}
            status={status}
            leads={grouped.get(status) ?? []}
          />
        ))}
      </div>

      {/* Exited leads section */}
      {exitedLeads.length > 0 && (
        <details className="mt-6">
          <summary className="text-[var(--text-muted)] text-xs uppercase tracking-wide font-medium cursor-pointer hover:text-[var(--text-secondary)] transition-colors">
            Exited ({exitedLeads.length})
          </summary>
          <div className="flex gap-4 mt-3 overflow-x-auto pb-4">
            {TERMINAL_STATUSES.map((status) => {
              const statusLeads = grouped.get(status) ?? []
              if (statusLeads.length === 0) return null
              return (
                <DroppableColumn
                  key={status}
                  status={status}
                  leads={statusLeads}
                />
              )
            })}
          </div>
        </details>
      )}
    </DndContext>
  )
}
