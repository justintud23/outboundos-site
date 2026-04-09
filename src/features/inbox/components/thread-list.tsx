'use client'

import { Badge } from '@/components/ui/badge'
import { formatEnumLabel } from '@/lib/format'
import type { InboxThreadDTO, InboxFilter } from '../types'
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

const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
  { key: 'interested', label: 'Interested' },
  { key: 'recent', label: 'Recent' },
]

function formatRelativeTime(date: Date): string {
  const now = Date.now()
  const diffMs = now - new Date(date).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d`
  return `${Math.floor(diffDay / 30)}mo`
}

interface ThreadListProps {
  threads: InboxThreadDTO[]
  selectedLeadId: string | null
  filter: InboxFilter
  onSelectThread: (leadId: string) => void
  onFilterChange: (filter: InboxFilter) => void
}

export function ThreadList({
  threads,
  selectedLeadId,
  filter,
  onSelectThread,
  onFilterChange,
}: ThreadListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex gap-1 px-4 py-3 border-b border-[var(--border-default)]">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => onFilterChange(f.key)}
            className={[
              'px-3 py-1.5 rounded-[var(--radius-btn)] text-xs font-medium transition-colors duration-[var(--transition-base)]',
              filter === f.key
                ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {threads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center px-4">
            {filter === 'unread' ? (
              <p className="text-[var(--text-muted)] text-sm">All caught up! No unread messages.</p>
            ) : (
              <>
                <p className="text-[var(--text-muted)] text-sm">No conversations yet.</p>
                <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">Send your first outreach to get started.</p>
              </>
            )}
          </div>
        )}

        {threads.map((thread) => (
          <button
            key={thread.leadId}
            onClick={() => onSelectThread(thread.leadId)}
            className={[
              'w-full text-left px-4 py-3 border-b border-[var(--border-subtle)] transition-colors duration-[var(--transition-fast)]',
              selectedLeadId === thread.leadId
                ? 'bg-[var(--accent-indigo-glow)]/30'
                : 'hover:bg-[var(--bg-surface-raised)]',
            ].join(' ')}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {thread.unreadCount > 0 && (
                    <span className="w-2 h-2 rounded-full bg-[var(--accent-indigo)] flex-shrink-0" />
                  )}
                  <span className={`text-sm truncate ${thread.unreadCount > 0 ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-primary)]'}`}>
                    {thread.leadName}
                  </span>
                </div>
                {thread.leadCompany && (
                  <p className="text-[var(--text-muted)] text-xs truncate mt-0.5">{thread.leadCompany}</p>
                )}
              </div>
              <div className="flex flex-col items-end gap-1 flex-shrink-0">
                <span className="text-[var(--text-muted)] text-xs">
                  {formatRelativeTime(thread.lastActivityAt)}
                </span>
                {thread.latestClassification && (
                  <Badge variant={CLASSIFICATION_VARIANT[thread.latestClassification]}>
                    {formatEnumLabel(thread.latestClassification)}
                  </Badge>
                )}
              </div>
            </div>
            {thread.latestPreview && (
              <p className="text-[var(--text-muted)] text-xs mt-1 line-clamp-1">{thread.latestPreview}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
