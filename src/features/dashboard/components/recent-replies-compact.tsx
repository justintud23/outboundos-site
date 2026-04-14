import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { MessageSquare } from 'lucide-react'
import { formatEnumLabel } from '@/lib/format'
import type { ReplyWithLeadDTO } from '@/features/replies/types'
import type { ReplyClassification } from '@prisma/client'

const VARIANT: Record<ReplyClassification, 'success' | 'muted' | 'danger' | 'warning' | 'default'> = {
  POSITIVE: 'success',
  NEUTRAL: 'muted',
  NEGATIVE: 'danger',
  OUT_OF_OFFICE: 'warning',
  UNSUBSCRIBE_REQUEST: 'danger',
  REFERRAL: 'default',
  UNKNOWN: 'muted',
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h`
  return `${Math.floor(diffHr / 24)}d`
}

export function RecentRepliesCompact({ replies }: { replies: ReplyWithLeadDTO[] }) {
  if (replies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2">
        <MessageSquare size={20} className="text-[var(--text-muted)]" aria-hidden="true" />
        <p className="text-[var(--text-muted)] text-xs">No replies yet</p>
      </div>
    )
  }

  return (
    <div className="space-y-0.5">
      {replies.map((reply) => (
        <Link
          key={reply.id}
          href="/inbox"
          className="flex items-center gap-2 px-2.5 py-2 rounded-[var(--radius-btn)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)] cursor-pointer"
        >
          <span className="text-[var(--text-primary)] text-xs truncate flex-1 font-medium">{reply.leadEmail}</span>
          <Badge variant={VARIANT[reply.classification]} showIcon>{formatEnumLabel(reply.classification)}</Badge>
          <span className="text-[var(--text-muted)] text-[10px] tabular-nums flex-shrink-0">{relativeTime(reply.receivedAt)}</span>
        </Link>
      ))}
    </div>
  )
}
