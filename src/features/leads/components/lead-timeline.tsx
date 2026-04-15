import {
  Send,
  MessageSquare,
  ArrowRightLeft,
  GitBranch,
  Inbox,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { relativeTime, formatEnumLabel } from '@/lib/format'
import type { TimelineItem, TimelineItemType } from '../types'
import type { ReplyClassification } from '@prisma/client'

const CLASSIFICATION_VARIANT: Record<ReplyClassification, 'success' | 'muted' | 'danger' | 'warning' | 'default'> = {
  POSITIVE: 'success',
  NEUTRAL: 'muted',
  NEGATIVE: 'danger',
  OUT_OF_OFFICE: 'warning',
  UNSUBSCRIBE_REQUEST: 'danger',
  REFERRAL: 'default',
  UNKNOWN: 'muted',
}

const TYPE_CONFIG: Record<
  TimelineItemType,
  { icon: typeof Send; color: string; bg: string; label: string }
> = {
  EMAIL_SENT: {
    icon: Send,
    color: 'text-[var(--accent-cyan)]',
    bg: 'rgba(56, 189, 248, 0.10)',
    label: 'Email Sent',
  },
  REPLY_RECEIVED: {
    icon: MessageSquare,
    color: 'text-[var(--accent-magenta)]',
    bg: 'rgba(167, 139, 250, 0.10)',
    label: 'Reply Received',
  },
  STATUS_CHANGE: {
    icon: ArrowRightLeft,
    color: 'text-[var(--status-warning)]',
    bg: 'rgba(234, 179, 8, 0.10)',
    label: 'Status Changed',
  },
  SEQUENCE_STEP: {
    icon: GitBranch,
    color: 'text-[var(--accent-indigo)]',
    bg: 'rgba(99, 102, 241, 0.10)',
    label: 'Sequence',
  },
}

interface LeadTimelineProps {
  items: TimelineItem[]
}

export function LeadTimeline({ items }: LeadTimelineProps) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <div className="w-12 h-12 rounded-xl bg-[var(--bg-surface-raised)] flex items-center justify-center">
          <Inbox size={22} className="text-[var(--text-muted)]" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[var(--text-secondary)] text-sm font-medium">No activity yet</p>
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Actions and messages will appear here as you engage with this lead.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Vertical line */}
      <div className="absolute left-[17px] top-0 bottom-0 w-px bg-[var(--border-default)]" />

      <div className="space-y-1">
        {items.map((item, index) => {
          const config = TYPE_CONFIG[item.type]
          const Icon = config.icon
          const classification = item.metadata?.classification as ReplyClassification | undefined

          return (
            <div
              key={item.id}
              className="relative flex items-start gap-3 pl-0 py-2 group"
              style={{ animationDelay: `${index * 30}ms` }}
            >
              {/* Icon dot */}
              <div
                className="relative z-10 w-[35px] h-[35px] rounded-lg flex items-center justify-center flex-shrink-0 border border-[var(--border-default)] bg-[var(--bg-surface)]"
                style={{ background: config.bg }}
              >
                <Icon size={15} className={config.color} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold uppercase tracking-wider ${config.color}`}>
                    {config.label}
                  </span>
                  {classification && (
                    <Badge variant={CLASSIFICATION_VARIANT[classification]}>
                      {formatEnumLabel(classification)}
                    </Badge>
                  )}
                </div>
                <p className="text-[var(--text-secondary)] text-sm mt-0.5 truncate">
                  {item.description}
                </p>
              </div>

              {/* Timestamp */}
              <span className="text-[var(--text-muted)] text-xs tabular-nums flex-shrink-0 pt-1.5">
                {relativeTime(item.timestamp)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
