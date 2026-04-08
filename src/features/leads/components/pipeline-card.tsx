'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Badge } from '@/components/ui/badge'
import type { PipelineLeadDTO } from '../types'

interface PipelineCardProps {
  lead: PipelineLeadDTO
}

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diffMs = now - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return `${Math.floor(diffDay / 30)}mo ago`
}

export function PipelineCard({ lead }: PipelineCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: lead.id, data: { lead } })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const name =
    [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] p-3 cursor-grab active:cursor-grabbing shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)] transition-all duration-[var(--transition-base)]"
    >
      <p className="text-[var(--text-primary)] text-sm font-medium truncate">
        {name}
      </p>
      {lead.company && (
        <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">
          {lead.company}
        </p>
      )}
      <div className="flex items-center justify-between mt-2">
        {lead.score !== null ? (
          <Badge
            variant={
              lead.score >= 70
                ? 'success'
                : lead.score >= 40
                  ? 'warning'
                  : 'danger'
            }
          >
            {lead.score}
          </Badge>
        ) : (
          <span />
        )}
        <span className="text-[var(--text-muted)] text-xs">
          {formatRelativeTime(new Date(lead.lastActivityAt))}
        </span>
      </div>
    </div>
  )
}
