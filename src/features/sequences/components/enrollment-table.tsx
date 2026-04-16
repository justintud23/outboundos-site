'use client'

import { Badge } from '@/components/ui/badge'
import { formatEnumLabel } from '@/lib/format'
import type { EnrollmentDTO } from '../types'
import type { EnrollmentStatus } from '@prisma/client'

const STATUS_VARIANT: Record<EnrollmentStatus, 'success' | 'warning' | 'muted' | 'danger'> = {
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'muted',
  STOPPED: 'danger',
}

interface EnrollmentTableProps {
  enrollments: EnrollmentDTO[]
  onAction: (enrollmentId: string, action: 'pause' | 'resume' | 'stop') => Promise<void>
}

export function EnrollmentTable({ enrollments, onAction }: EnrollmentTableProps) {
  if (enrollments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[var(--text-secondary)] text-sm">No leads enrolled yet.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)] bg-[var(--bg-surface-raised)]/60">
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Lead</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Step</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden md:table-cell">Next Due</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {enrollments.map((enrollment) => (
            <tr key={enrollment.id} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]">
              <td className="py-3 px-4">
                <div className="text-[var(--text-primary)] font-medium">{enrollment.leadName}</div>
                <div className="text-[var(--text-muted)] text-xs">{enrollment.leadEmail}</div>
              </td>
              <td className="py-3 px-4 text-[var(--text-secondary)] text-xs tabular-nums">
                {enrollment.currentStepNumber}/{enrollment.totalSteps}
              </td>
              <td className="py-3 px-4">
                <Badge variant={STATUS_VARIANT[enrollment.status]}>
                  {formatEnumLabel(enrollment.status)}
                </Badge>
                {enrollment.stoppedReason && (
                  <span className="text-[var(--text-muted)] text-xs ml-1">({enrollment.stoppedReason})</span>
                )}
              </td>
              <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden md:table-cell">
                {enrollment.nextDueAt
                  ? new Date(enrollment.nextDueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : '\u2014'}
              </td>
              <td className="py-3 px-4">
                {enrollment.status === 'ACTIVE' && (
                  <div className="flex gap-2">
                    <button onClick={() => void onAction(enrollment.id, 'pause')} className="text-xs font-medium text-[var(--status-warning)] hover:bg-[var(--status-warning-bg)] px-1.5 py-0.5 rounded-[var(--radius-btn)] transition-colors duration-[var(--transition-fast)] cursor-pointer">Pause</button>
                    <button onClick={() => void onAction(enrollment.id, 'stop')} className="text-xs font-medium text-[var(--status-danger)] hover:bg-[var(--status-danger-bg)] px-1.5 py-0.5 rounded-[var(--radius-btn)] transition-colors duration-[var(--transition-fast)] cursor-pointer">Stop</button>
                  </div>
                )}
                {enrollment.status === 'PAUSED' && (
                  <button onClick={() => void onAction(enrollment.id, 'resume')} className="text-xs font-medium text-[var(--status-success)] hover:bg-[var(--status-success-bg)] px-1.5 py-0.5 rounded-[var(--radius-btn)] transition-colors duration-[var(--transition-fast)] cursor-pointer">Resume</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
