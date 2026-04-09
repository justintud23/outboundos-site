import { Badge } from '@/components/ui/badge'
import type { ThreadMessageDTO } from '../types'
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

const CLASSIFICATION_LABEL: Record<ReplyClassification, string> = {
  POSITIVE: 'Positive',
  NEUTRAL: 'Neutral',
  NEGATIVE: 'Negative',
  OUT_OF_OFFICE: 'Out of Office',
  UNSUBSCRIBE_REQUEST: 'Unsubscribe',
  REFERRAL: 'Referral',
  UNKNOWN: 'Unknown',
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function MessageBubble({ message }: { message: ThreadMessageDTO }) {
  const isOutbound = message.direction === 'outbound'

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={[
          'max-w-[75%] rounded-[var(--radius-card)] p-4 space-y-2',
          isOutbound
            ? 'bg-[var(--accent-indigo-glow)] border border-[var(--accent-indigo)]/20'
            : 'bg-[var(--bg-surface)] border border-[var(--border-default)]',
        ].join(' ')}
      >
        {isOutbound && message.subject && (
          <p className="text-[var(--text-primary)] text-sm font-medium">{message.subject}</p>
        )}

        <p className="text-[var(--text-secondary)] text-sm whitespace-pre-wrap leading-relaxed">
          {message.body}
        </p>

        <div className={`flex items-center gap-2 ${isOutbound ? 'justify-end' : 'justify-start'}`}>
          {!isOutbound && message.classification && (
            <Badge variant={CLASSIFICATION_VARIANT[message.classification]}>
              {CLASSIFICATION_LABEL[message.classification]}
            </Badge>
          )}

          {!isOutbound && message.classificationConfidence !== undefined && (
            <span className="text-[var(--text-muted)] text-xs">
              {Math.round(message.classificationConfidence * 100)}%
            </span>
          )}

          <span className="text-[var(--text-muted)] text-xs">
            {formatTime(message.timestamp)}
          </span>
        </div>
      </div>
    </div>
  )
}
