import { ActionItem } from './action-item'
import { CheckCircle2 } from 'lucide-react'
import type { NextAction } from '../types'

interface ActionCenterListProps {
  actions: NextAction[]
}

export function ActionCenterList({ actions }: ActionCenterListProps) {
  if (actions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-[var(--status-success-bg)] flex items-center justify-center">
          <CheckCircle2 size={28} className="text-[var(--status-success)]" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[var(--text-primary)] text-lg font-semibold mb-1">
            You're all caught up
          </p>
          <p className="text-[var(--text-muted)] text-sm max-w-xs mx-auto">
            No actions need your attention right now. New actions will appear here as your pipeline moves.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 stagger-grid">
      {actions.map((action) => (
        <ActionItem key={action.id} action={action} />
      ))}
    </div>
  )
}
