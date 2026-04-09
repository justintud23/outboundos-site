'use client'

import { Badge } from '@/components/ui/badge'
import { formatEnumLabel } from '@/lib/format'
import { MessageBubble } from './message-bubble'
import type { ThreadDetailDTO } from '../types'
import type { LeadStatus } from '@prisma/client'

const STATUS_VARIANT: Record<LeadStatus, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
  NEW: 'default',
  CONTACTED: 'warning',
  REPLIED: 'success',
  BOUNCED: 'danger',
  UNSUBSCRIBED: 'danger',
  CONVERTED: 'success',
  INTERESTED: 'success',
  NOT_INTERESTED: 'danger',
}

interface ThreadDetailProps {
  thread: ThreadDetailDTO | null
  loading: boolean
  onBack?: () => void
}

export function ThreadDetail({ thread, loading, onBack }: ThreadDetailProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-muted)] text-sm">Loading conversation...</p>
      </div>
    )
  }

  if (!thread) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[var(--text-muted)] text-sm">Select a conversation to view messages</p>
      </div>
    )
  }

  const leadName = [thread.lead.firstName, thread.lead.lastName].filter(Boolean).join(' ') || thread.lead.email

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-[var(--border-default)] bg-[var(--bg-surface)]/60 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="lg:hidden text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-sm"
            >
              &larr;
            </button>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-[var(--text-primary)] font-semibold text-sm">{leadName}</h2>
              <Badge variant={STATUS_VARIANT[thread.lead.status]}>
                {formatEnumLabel(thread.lead.status)}
              </Badge>
              {thread.lead.score !== null && (
                <Badge variant={thread.lead.score >= 70 ? 'success' : thread.lead.score >= 40 ? 'warning' : 'danger'}>
                  {thread.lead.score}
                </Badge>
              )}
            </div>
            <p className="text-[var(--text-muted)] text-xs mt-0.5">
              {thread.lead.email}
              {thread.lead.company && ` \u00B7 ${thread.lead.company}`}
              {thread.lead.title && ` \u00B7 ${thread.lead.title}`}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {thread.messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-[var(--text-muted)] text-sm">No messages in this conversation.</p>
          </div>
        ) : (
          thread.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
      </div>
    </div>
  )
}
