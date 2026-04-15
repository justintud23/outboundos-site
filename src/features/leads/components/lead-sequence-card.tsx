import Link from 'next/link'
import { GitBranch, Clock, PlayCircle, CheckCircle2, PauseCircle, StopCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { relativeTime, formatEnumLabel } from '@/lib/format'
import type { LeadSequenceDTO } from '../types'

const STATUS_CONFIG: Record<string, { icon: typeof PlayCircle; variant: 'success' | 'warning' | 'danger' | 'muted' }> = {
  ACTIVE: { icon: PlayCircle, variant: 'success' },
  PAUSED: { icon: PauseCircle, variant: 'warning' },
  COMPLETED: { icon: CheckCircle2, variant: 'success' },
  STOPPED: { icon: StopCircle, variant: 'danger' },
}

interface LeadSequenceCardProps {
  sequence: LeadSequenceDTO | null
}

export function LeadSequenceCard({ sequence }: LeadSequenceCardProps) {
  if (!sequence) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[var(--bg-surface-raised)] flex items-center justify-center">
          <GitBranch size={18} className="text-[var(--text-muted)]" aria-hidden="true" />
        </div>
        <div>
          <p className="text-[var(--text-secondary)] text-sm font-medium">Not enrolled</p>
          <p className="text-[var(--text-muted)] text-xs mt-0.5">
            This lead is not in any sequence.
          </p>
        </div>
      </div>
    )
  }

  const statusConfig = STATUS_CONFIG[sequence.status] ?? STATUS_CONFIG.ACTIVE
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- ACTIVE fallback always exists
  const { icon: StatusIcon, variant: statusVariant } = statusConfig!
  const progress = sequence.totalSteps > 0
    ? Math.round((sequence.currentStepNumber / sequence.totalSteps) * 100)
    : 0

  return (
    <div className="space-y-3">
      {/* Sequence name + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <GitBranch size={14} className="text-[var(--accent-indigo)] flex-shrink-0" />
          <span className="text-[var(--text-primary)] text-sm font-medium truncate">
            {sequence.sequenceName}
          </span>
        </div>
        <Badge variant={statusVariant}>
          <StatusIcon size={11} className="mr-0.5" />
          {formatEnumLabel(sequence.status)}
        </Badge>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-[var(--text-muted)]">
            Step {sequence.currentStepNumber} of {sequence.totalSteps}
          </span>
          <span className="text-[var(--text-muted)] tabular-nums">{progress}%</span>
        </div>
        <div className="h-1.5 bg-[var(--bg-surface-raised)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--accent-indigo)] rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Details */}
      <div className="space-y-1.5 text-xs">
        {sequence.currentStepSubject && (
          <div className="flex items-start gap-2">
            <span className="text-[var(--text-muted)] flex-shrink-0">Current:</span>
            <span className="text-[var(--text-secondary)] truncate">{sequence.currentStepSubject}</span>
          </div>
        )}
        {sequence.nextStepSubject && sequence.status === 'ACTIVE' && (
          <div className="flex items-start gap-2">
            <span className="text-[var(--text-muted)] flex-shrink-0">Next:</span>
            <span className="text-[var(--text-secondary)] truncate">{sequence.nextStepSubject}</span>
          </div>
        )}
        {sequence.nextDueAt && sequence.status === 'ACTIVE' && (
          <div className="flex items-center gap-1.5 text-[var(--text-muted)]">
            <Clock size={12} />
            <span>Due {relativeTime(sequence.nextDueAt)}</span>
          </div>
        )}
        {sequence.stoppedReason && (
          <p className="text-[var(--status-danger)] text-xs">{sequence.stoppedReason}</p>
        )}
      </div>

      {/* View sequence link */}
      <Link
        href="/sequences"
        className="text-[var(--accent-indigo)] hover:text-[var(--accent-indigo-hover)] text-xs font-medium transition-colors inline-block mt-1"
      >
        View Sequence
      </Link>
    </div>
  )
}
