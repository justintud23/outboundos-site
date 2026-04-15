'use client'

import {
  MessageSquare,
  FileCheck,
  Send,
  Reply,
  GitBranch,
  UserCheck,
  Star,
  CheckCircle2,
} from 'lucide-react'
import type { NextAction, ActionType } from '@/features/actions/types'
import { ACTION_CTA, getUrgencyTier } from '@/features/actions/types'
import type { LucideIcon } from 'lucide-react'

// Action types that support inline execution
const INLINE_TYPES = new Set<ActionType>([
  'APPROVE_DRAFT',
  'SEND_DRAFT',
  'MARK_CONVERTED',
])

export function isInlineAction(type: ActionType): boolean {
  return INLINE_TYPES.has(type)
}

const TYPE_CONFIG: Record<ActionType, {
  accent: string
  bg: string
  text: string
  icon: LucideIcon
  ctaBg: string
  ctaHoverBg: string
}> = {
  REVIEW_REPLY: {
    accent: 'var(--accent-magenta)',
    bg: 'rgba(167, 139, 250, 0.10)',
    text: 'text-[var(--accent-magenta)]',
    icon: MessageSquare,
    ctaBg: 'bg-[rgba(167,139,250,0.12)]',
    ctaHoverBg: 'hover:bg-[rgba(167,139,250,0.22)]',
  },
  APPROVE_DRAFT: {
    accent: 'var(--accent-indigo)',
    bg: 'rgba(99, 102, 241, 0.10)',
    text: 'text-[var(--accent-indigo)]',
    icon: FileCheck,
    ctaBg: 'bg-[var(--accent-indigo-glow)]',
    ctaHoverBg: 'hover:bg-[rgba(99,102,241,0.28)]',
  },
  SEND_DRAFT: {
    accent: 'var(--accent-cyan)',
    bg: 'rgba(56, 189, 248, 0.10)',
    text: 'text-[var(--accent-cyan)]',
    icon: Send,
    ctaBg: 'bg-[rgba(56,189,248,0.12)]',
    ctaHoverBg: 'hover:bg-[rgba(56,189,248,0.22)]',
  },
  FOLLOW_UP: {
    accent: 'var(--status-warning)',
    bg: 'rgba(234, 179, 8, 0.10)',
    text: 'text-[var(--status-warning)]',
    icon: Reply,
    ctaBg: 'bg-[var(--status-warning-bg)]',
    ctaHoverBg: 'hover:bg-[rgba(234,179,8,0.22)]',
  },
  ENROLL_SEQUENCE: {
    accent: 'var(--accent-indigo)',
    bg: 'rgba(99, 102, 241, 0.08)',
    text: 'text-[var(--accent-indigo-hover)]',
    icon: GitBranch,
    ctaBg: 'bg-[rgba(99,102,241,0.10)]',
    ctaHoverBg: 'hover:bg-[rgba(99,102,241,0.20)]',
  },
  REVIEW_INTERESTED_LEAD: {
    accent: 'var(--status-success)',
    bg: 'rgba(34, 197, 94, 0.10)',
    text: 'text-[var(--status-success)]',
    icon: Star,
    ctaBg: 'bg-[var(--status-success-bg)]',
    ctaHoverBg: 'hover:bg-[rgba(34,197,94,0.22)]',
  },
  MARK_CONVERTED: {
    accent: 'var(--chart-positive)',
    bg: 'rgba(52, 211, 153, 0.10)',
    text: 'text-[var(--chart-positive)]',
    icon: UserCheck,
    ctaBg: 'bg-[rgba(52,211,153,0.12)]',
    ctaHoverBg: 'hover:bg-[rgba(52,211,153,0.22)]',
  },
  NO_ACTION: {
    accent: 'var(--text-muted)',
    bg: 'rgba(71, 85, 105, 0.10)',
    text: 'text-[var(--text-muted)]',
    icon: FileCheck,
    ctaBg: 'bg-[var(--bg-surface-raised)]',
    ctaHoverBg: 'hover:bg-[var(--bg-surface-overlay)]',
  },
}

const SUCCESS_LABELS: Partial<Record<ActionType, string>> = {
  APPROVE_DRAFT: 'Approved',
  SEND_DRAFT: 'Sent',
  MARK_CONVERTED: 'Converted',
}

function UrgencyDot({ priority }: { priority: number }) {
  const tier = getUrgencyTier(priority)
  if (tier === 'low') return null
  if (tier === 'high') {
    return (
      <span className="relative flex h-2 w-2 flex-shrink-0" aria-hidden="true">
        <span className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping" style={{ backgroundColor: 'var(--accent-magenta)' }} />
        <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--accent-magenta)' }} />
      </span>
    )
  }
  return (
    <span className="inline-flex h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--status-warning)' }} aria-hidden="true" />
  )
}

export async function executeAction(action: NextAction): Promise<void> {
  switch (action.type) {
    case 'APPROVE_DRAFT': {
      if (!action.draftId) throw new Error('Missing draft ID')
      const res = await fetch(`/api/drafts/${action.draftId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Failed to approve draft')
      }
      return
    }
    case 'SEND_DRAFT': {
      if (!action.draftId) throw new Error('Missing draft ID')
      const res = await fetch(`/api/drafts/${action.draftId}/send`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Failed to send draft')
      }
      return
    }
    case 'MARK_CONVERTED': {
      if (!action.leadId) throw new Error('Missing lead ID')
      const res = await fetch(`/api/leads/${action.leadId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CONVERTED' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Failed to convert lead')
      }
      return
    }
    default:
      throw new Error(`Inline execution not supported for ${action.type}`)
  }
}

type ItemPhase = 'idle' | 'ghost' | 'dismissing'

interface InlineActionItemProps {
  action: NextAction
  phase: ItemPhase
  onExecute: (action: NextAction) => void
  onUndo: (action: NextAction) => void
}

export function InlineActionItem({ action, phase, onExecute, onUndo }: InlineActionItemProps) {
  const cta = ACTION_CTA[action.type]
  const config = TYPE_CONFIG[action.type]
  const Icon = config.icon
  const tier = getUrgencyTier(action.priority)
  const borderWidth = tier === 'high' ? 3 : tier === 'medium' ? 3 : 2

  const isGhost = phase === 'ghost'
  const isDismissing = phase === 'dismissing'
  const isInteractive = phase === 'idle'

  return (
    <div
      className={[
        'flex items-center gap-3 px-2.5 py-2 rounded-[var(--radius-btn)] action-list-item',
        isInteractive ? 'hover:bg-[var(--bg-surface-raised)]' : '',
        isGhost ? 'opacity-75' : '',
        isDismissing ? 'animate-dismiss pointer-events-none' : '',
      ].join(' ')}
      style={{
        borderLeft: `${borderWidth}px solid ${isGhost ? 'var(--status-success)' : config.accent}`,
        transition: isGhost ? 'border-color 0.2s ease-out, opacity 0.2s ease-out' : undefined,
      }}
    >
      {/* Icon */}
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ background: isGhost ? 'rgba(34, 197, 94, 0.10)' : config.bg }}
        aria-hidden="true"
      >
        {isGhost ? (
          <CheckCircle2 size={14} className="text-[var(--status-success)]" />
        ) : (
          <Icon size={14} className={config.text} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {isGhost ? (
          <span className="text-[var(--status-success)] text-[10px] font-semibold uppercase tracking-wider">
            {SUCCESS_LABELS[action.type] ?? 'Done'}
          </span>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <UrgencyDot priority={action.priority} />
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.text}`}>
                {action.label}
              </span>
            </div>
            {action.reason && (
              <p className="text-[var(--text-muted)] text-[11px] truncate">{action.reason}</p>
            )}
          </>
        )}
      </div>

      {/* CTA or Undo */}
      {isGhost ? (
        <button
          onClick={() => onUndo(action)}
          className="text-[11px] px-2 py-1 rounded-[var(--radius-btn)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] transition-all duration-[var(--transition-fast)] flex-shrink-0 font-medium cursor-pointer"
        >
          Undo
        </button>
      ) : cta && isInteractive ? (
        <button
          onClick={() => onExecute(action)}
          className={`text-[11px] px-2 py-1 rounded-[var(--radius-btn)] ${config.ctaBg} ${config.ctaHoverBg} ${config.text} transition-all duration-[var(--transition-base)] flex-shrink-0 font-medium cursor-pointer active:scale-[0.97]`}
        >
          {cta}
        </button>
      ) : null}
    </div>
  )
}
