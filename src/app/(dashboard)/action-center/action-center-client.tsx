'use client'

import { useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { ActionCenterList } from '@/features/actions/components/action-center-list'
import type { NextAction, ActionType } from '@/features/actions/types'
import { ACTION_LABELS } from '@/features/actions/types'

interface ActionCenterClientProps {
  initialActions: NextAction[]
}

const TYPE_COLORS: Record<ActionType, string> = {
  REVIEW_REPLY: 'bg-[rgba(167,139,250,0.12)] text-[var(--accent-magenta)]',
  APPROVE_DRAFT: 'bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)]',
  SEND_DRAFT: 'bg-[rgba(56,189,248,0.12)] text-[var(--accent-cyan)]',
  FOLLOW_UP: 'bg-[var(--status-warning-bg)] text-[var(--status-warning)]',
  ENROLL_SEQUENCE: 'bg-[rgba(99,102,241,0.10)] text-[var(--accent-indigo-hover)]',
  REVIEW_INTERESTED_LEAD: 'bg-[var(--status-success-bg)] text-[var(--status-success)]',
  MARK_CONVERTED: 'bg-[rgba(52,211,153,0.12)] text-[var(--chart-positive)]',
  NO_ACTION: 'bg-[var(--bg-surface-raised)] text-[var(--text-muted)]',
}

export function ActionCenterClient({ initialActions }: ActionCenterClientProps) {
  const [actions, setActions] = useState(initialActions)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const res = await fetch('/api/actions')
      if (res.ok) {
        const data = await res.json() as { actions: NextAction[] }
        setActions(data.actions)
      }
    } finally {
      setRefreshing(false)
    }
  }, [])

  // Group by type for summary pills
  const typeCounts = actions.reduce<Partial<Record<ActionType, number>>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[var(--text-secondary)] text-sm">
            What needs your attention right now
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="p-1.5 rounded-[var(--radius-btn)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] transition-all duration-[var(--transition-base)] disabled:opacity-40 cursor-pointer flex-shrink-0"
          aria-label="Refresh actions"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>

      {/* Summary pills */}
      {actions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[var(--text-primary)] text-sm font-medium tabular-nums">
            {actions.length} pending
          </span>
          <span className="text-[var(--border-default)]" aria-hidden="true">|</span>
          {(Object.entries(typeCounts) as [ActionType, number][]).map(([type, count]) => (
            <span
              key={type}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[var(--radius-badge)] text-xs font-medium ${TYPE_COLORS[type]}`}
            >
              <span className="tabular-nums">{count}</span>
              {ACTION_LABELS[type]}
            </span>
          ))}
        </div>
      )}

      {/* Action list */}
      <ActionCenterList actions={actions} />
    </div>
  )
}
