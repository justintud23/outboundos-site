'use client'

import { useState, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { ActionItem } from '@/features/actions/components/action-item'
import type { NextAction } from '@/features/actions/types'

interface ActionCenterClientProps {
  initialActions: NextAction[]
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

  // Group by type for summary
  const counts = actions.reduce<Record<string, number>>((acc, a) => {
    acc[a.type] = (acc[a.type] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Summary bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <p className="text-[var(--text-secondary)] text-sm">
            {actions.length} action{actions.length !== 1 ? 's' : ''} pending
          </p>
          {Object.entries(counts).map(([type, count]) => (
            <span key={type} className="text-[var(--text-muted)] text-xs">
              {count} {type.toLowerCase().replace(/_/g, ' ')}
            </span>
          ))}
        </div>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Action list */}
      {actions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[var(--status-success)] text-lg font-medium mb-1">You're all caught up</p>
          <p className="text-[var(--text-muted)] text-sm">No actions need your attention right now.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {actions.map((action, i) => (
            <ActionItem key={`${action.type}-${action.leadId ?? action.draftId ?? i}`} action={action} />
          ))}
        </div>
      )}
    </div>
  )
}
