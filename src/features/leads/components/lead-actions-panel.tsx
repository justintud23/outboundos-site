'use client'

import { ActionItem } from '@/features/actions/components/action-item'
import { InlineActionItem, isInlineAction } from './inline-action-item'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import type { NextAction } from '@/features/actions/types'

interface LeadActionsPanelProps {
  actions: NextAction[]
  ghostIds: Set<string>
  dismissedIds: Set<string>
  errorActionId: string | null
  errorMessage: string | null
  onExecute: (action: NextAction) => void
  onUndo: (action: NextAction) => void
}

export function LeadActionsPanel({
  actions,
  ghostIds,
  dismissedIds,
  errorActionId,
  errorMessage,
  onExecute,
  onUndo,
}: LeadActionsPanelProps) {
  const visibleActions = actions.slice(0, 5)

  if (visibleActions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--status-success-bg)] flex items-center justify-center">
          <CheckCircle2 size={20} className="text-[var(--status-success)]" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[var(--text-primary)] text-sm font-medium">All caught up</p>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            No actions needed for this lead right now.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {visibleActions.map((action) => {
        const isGhost = ghostIds.has(action.id)
        const isDismissed = dismissedIds.has(action.id)
        const isError = errorActionId === action.id

        if (isInlineAction(action.type)) {
          const phase = isError ? 'idle' as const
            : isDismissed ? 'dismissing' as const
            : isGhost ? 'ghost' as const
            : 'idle' as const

          return (
            <div key={action.id} className="action-list-item">
              <InlineActionItem
                action={action}
                phase={phase}
                onExecute={onExecute}
                onUndo={onUndo}
              />
              {isError && errorMessage && (
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 mt-1 rounded-[var(--radius-btn)] bg-[var(--status-danger-bg)]">
                  <AlertCircle size={12} className="text-[var(--status-danger)] flex-shrink-0" />
                  <span className="text-[var(--status-danger)] text-[11px] truncate">{errorMessage}</span>
                </div>
              )}
            </div>
          )
        }

        return <ActionItem key={action.id} action={action} compact />
      })}
    </div>
  )
}
