import Link from 'next/link'
import { CheckCircle2, ArrowRight } from 'lucide-react'
import { ActionItem } from '@/features/actions/components/action-item'
import type { NextAction } from '@/features/actions/types'

interface ActionCenterModuleProps {
  actions: NextAction[]
}

export function ActionCenterModule({ actions }: ActionCenterModuleProps) {
  if (actions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <CheckCircle2 size={20} className="text-[var(--status-success)]" aria-hidden="true" />
        <p className="text-[var(--text-secondary)] text-xs font-medium">You're all caught up</p>
        <p className="text-[var(--text-muted)] text-[11px]">No actions need attention right now</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="space-y-0.5 flex-1">
        {actions.map((action) => (
          <ActionItem key={action.id} action={action} compact />
        ))}
      </div>

      {/* View all link */}
      <Link
        href="/action-center"
        className="flex items-center justify-center gap-1.5 mt-3 pt-3 border-t border-[var(--border-subtle)] text-[var(--accent-indigo)] hover:text-[var(--accent-indigo-hover)] text-xs font-medium transition-colors cursor-pointer"
      >
        View all actions
        <ArrowRight size={12} aria-hidden="true" />
      </Link>
    </div>
  )
}
