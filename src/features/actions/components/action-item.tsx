import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { NextAction, ActionType } from '../types'
import { ACTION_CTA, ACTION_HREF } from '../types'

const TYPE_VARIANT: Record<ActionType, 'danger' | 'warning' | 'success' | 'default' | 'muted'> = {
  REVIEW_REPLY: 'danger',
  APPROVE_DRAFT: 'warning',
  SEND_DRAFT: 'success',
  FOLLOW_UP: 'default',
  ENROLL_SEQUENCE: 'muted',
  MARK_CONVERTED: 'success',
  NO_ACTION: 'muted',
}

const TYPE_ACCENT: Record<ActionType, string> = {
  REVIEW_REPLY: 'var(--status-danger)',
  APPROVE_DRAFT: 'var(--status-warning)',
  SEND_DRAFT: 'var(--status-success)',
  FOLLOW_UP: 'var(--accent-indigo)',
  ENROLL_SEQUENCE: 'var(--accent-cyan)',
  MARK_CONVERTED: 'var(--chart-positive)',
  NO_ACTION: 'var(--text-muted)',
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  return `${Math.floor(diffHr / 24)}d ago`
}

export function ActionItem({ action }: { action: NextAction }) {
  const href = ACTION_HREF[action.type]
  const cta = ACTION_CTA[action.type]

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)] transition-all duration-[var(--transition-base)]"
      style={{ borderLeftWidth: 3, borderLeftColor: TYPE_ACCENT[action.type] }}
    >
      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Badge variant={TYPE_VARIANT[action.type]}>{action.label}</Badge>
          {action.leadName && (
            <span className="text-[var(--text-primary)] text-sm font-medium truncate">{action.leadName}</span>
          )}
        </div>
        {action.description && (
          <p className="text-[var(--text-muted)] text-xs truncate">{action.description}</p>
        )}
      </div>

      {/* Timestamp */}
      <span className="text-[var(--text-muted)] text-xs flex-shrink-0">
        {relativeTime(action.createdAt)}
      </span>

      {/* CTA */}
      {cta && (
        <Link
          href={href}
          className="text-xs px-3 py-1.5 rounded-[var(--radius-btn)] bg-[var(--bg-surface-raised)] hover:bg-[var(--accent-indigo)] text-[var(--text-primary)] transition-colors duration-[var(--transition-base)] flex-shrink-0 font-medium"
        >
          {cta}
        </Link>
      )}
    </div>
  )
}
