import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import type { SequenceDTO } from '../types'

export function SequenceCard({ sequence }: { sequence: SequenceDTO }) {
  const totalEnrollments = sequence.activeEnrollments + sequence.completedEnrollments + sequence.stoppedEnrollments

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5 flex flex-col gap-3 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)] hover:border-[var(--border-glow)] transition-all duration-[var(--transition-base)]">
      <div className="flex items-start justify-between gap-3">
        <Link
          href={`/sequences/${sequence.id}`}
          className="text-[var(--text-primary)] font-semibold text-sm leading-snug hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          {sequence.name}
        </Link>
        <Badge variant="muted">{sequence.stepCount} step{sequence.stepCount !== 1 ? 's' : ''}</Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 py-2 border-t border-[var(--border-subtle)]">
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Active</p>
          <p className="text-[var(--status-success)] text-sm font-medium tabular-nums">{sequence.activeEnrollments}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Completed</p>
          <p className="text-[var(--text-primary)] text-sm font-medium tabular-nums">{sequence.completedEnrollments}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide mb-0.5">Stopped</p>
          <p className="text-[var(--text-secondary)] text-sm font-medium tabular-nums">{sequence.stoppedEnrollments}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[var(--text-muted)] text-xs">
          {totalEnrollments} enrolled
        </span>
        <Link
          href={`/sequences/${sequence.id}`}
          className="text-[var(--accent-indigo)] text-xs hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          View Details &rarr;
        </Link>
      </div>
    </div>
  )
}
