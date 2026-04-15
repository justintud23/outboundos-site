import Link from 'next/link'
import {
  MessageSquare,
  FileCheck,
  Send,
  Reply,
  GitBranch,
  UserCheck,
  Star,
} from 'lucide-react'
import type { NextAction, ActionType } from '../types'
import { ACTION_CTA, ACTION_HREF, getUrgencyTier } from '../types'
import { relativeTime } from '@/lib/format'
import type { LucideIcon } from 'lucide-react'

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
  // medium
  return (
    <span className="inline-flex h-1.5 w-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--status-warning)' }} aria-hidden="true" />
  )
}

interface ActionItemProps {
  action: NextAction
  compact?: boolean
}

export function ActionItem({ action, compact = false }: ActionItemProps) {
  const defaultHref = action.leadId ? `/leads/${action.leadId}` : ACTION_HREF[action.type]
  const href = action.href ?? defaultHref
  const cta = ACTION_CTA[action.type]
  const config = TYPE_CONFIG[action.type]
  const Icon = config.icon
  const tier = getUrgencyTier(action.priority)
  const borderWidth = tier === 'high' ? 3 : tier === 'medium' ? 3 : 2

  if (compact) {
    return (
      <div
        className="flex items-center gap-3 px-2.5 py-2 rounded-[var(--radius-btn)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]"
        style={{ borderLeft: `${borderWidth}px solid ${config.accent}` }}
      >
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: config.bg }}
          aria-hidden="true"
        >
          <Icon size={14} className={config.text} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <UrgencyDot priority={action.priority} />
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.text}`}>
              {action.label}
            </span>
            {action.leadName && (
              <span className="text-[var(--text-primary)] text-xs font-medium truncate">
                {action.leadName}
              </span>
            )}
          </div>
          {action.reason && (
            <p className="text-[var(--text-muted)] text-[11px] truncate">{action.reason}</p>
          )}
        </div>

        {cta && (
          <Link
            href={href}
            className={`text-[11px] px-2 py-1 rounded-[var(--radius-btn)] ${config.ctaBg} ${config.ctaHoverBg} ${config.text} transition-all duration-[var(--transition-base)] flex-shrink-0 font-medium cursor-pointer active:scale-[0.97]`}
          >
            {cta}
          </Link>
        )}
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-4 px-4 py-3.5 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)] transition-all duration-[var(--transition-base)] animate-fade-in-up"
      style={{ borderLeftWidth: borderWidth, borderLeftColor: config.accent }}
    >
      {/* Icon */}
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: config.bg }}
        aria-hidden="true"
      >
        <Icon size={16} className={config.text} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <UrgencyDot priority={action.priority} />
          <span className={`text-xs font-semibold uppercase tracking-wider ${config.text}`}>
            {action.label}
          </span>
          {action.leadName && (
            <span className="text-[var(--text-primary)] text-sm font-medium truncate">
              {action.leadName}
            </span>
          )}
        </div>
        {action.description && (
          <p className="text-[var(--text-secondary)] text-xs truncate">{action.description}</p>
        )}
        {action.reason && (
          <p className="text-[var(--text-muted)] text-[11px] mt-0.5 truncate">{action.reason}</p>
        )}
      </div>

      {/* Timestamp */}
      <span className="text-[var(--text-muted)] text-xs tabular-nums flex-shrink-0 hidden sm:block">
        {relativeTime(action.createdAt)}
      </span>

      {/* CTA */}
      {cta && (
        <Link
          href={href}
          className={`text-xs px-3 py-1.5 rounded-[var(--radius-btn)] ${config.ctaBg} ${config.ctaHoverBg} ${config.text} transition-all duration-[var(--transition-base)] flex-shrink-0 font-medium cursor-pointer active:scale-[0.97]`}
        >
          {cta}
        </Link>
      )}
    </div>
  )
}
