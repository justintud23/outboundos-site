'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { EnrollmentTable } from '@/features/sequences/components/enrollment-table'
import { EnrollModal } from '@/features/sequences/components/enroll-modal'
import type { SequenceDetailDTO, EnrollmentDTO } from '@/features/sequences/types'
import type { LeadStatus } from '@prisma/client'

interface SequenceDetailClientProps {
  sequence: SequenceDetailDTO
  initialEnrollments: EnrollmentDTO[]
  leads: { id: string; email: string; firstName: string | null; lastName: string | null; status: LeadStatus }[]
}

export function SequenceDetailClient({ sequence, initialEnrollments, leads }: SequenceDetailClientProps) {
  const [enrollments, setEnrollments] = useState(initialEnrollments)
  const [showEnroll, setShowEnroll] = useState(false)

  const enrolledLeadIds = new Set(enrollments.map((e) => e.leadId))

  async function handleEnrollmentAction(enrollmentId: string, action: 'pause' | 'resume' | 'stop') {
    const res = await fetch(`/api/sequences/enrollments/${enrollmentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })

    if (res.ok) {
      window.location.reload()
    }
  }

  function handleEnrolled() {
    setShowEnroll(false)
    window.location.reload()
  }

  return (
    <div className="space-y-8">
      <Link href="/sequences" className="text-[var(--text-muted)] text-xs hover:text-[var(--text-secondary)] transition-colors">
        &larr; Sequences
      </Link>

      <div>
        <h2 className="text-[var(--text-primary)] font-semibold text-sm mb-3">Steps</h2>
        <div className="flex flex-col gap-2">
          {sequence.steps.map((step, i) => (
            <div key={step.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)] flex items-center justify-center text-xs font-medium">
                  {step.stepNumber}
                </div>
                {i < sequence.steps.length - 1 && (
                  <div className="w-px h-8 bg-[var(--border-default)]" />
                )}
              </div>
              <div className="flex-1 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] p-3">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-[var(--text-primary)] text-sm font-medium">{step.subject}</p>
                  {step.delayDays > 0 && (
                    <Badge variant="muted">+{step.delayDays}d</Badge>
                  )}
                </div>
                <p className="text-[var(--text-muted)] text-xs line-clamp-2">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[var(--text-primary)] font-semibold text-sm">
            Enrolled Leads
            <span className="ml-2 text-[var(--text-muted)] font-normal">{enrollments.length}</span>
          </h2>
          <button
            onClick={() => setShowEnroll(true)}
            className="text-xs px-3 py-1.5 rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] text-white hover:bg-[var(--accent-indigo-hover)] transition-colors font-medium"
          >
            Enroll Leads
          </button>
        </div>
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
          <EnrollmentTable enrollments={enrollments} onAction={handleEnrollmentAction} />
        </div>
      </div>

      {showEnroll && (
        <EnrollModal
          sequenceId={sequence.id}
          leads={leads}
          enrolledLeadIds={enrolledLeadIds}
          onClose={() => setShowEnroll(false)}
          onEnrolled={handleEnrolled}
        />
      )}
    </div>
  )
}
