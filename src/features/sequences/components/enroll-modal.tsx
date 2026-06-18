'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import type { LeadStatus } from '@prisma/client'
import { TERMINAL_STATUSES } from '@/features/leads/types'

interface LeadOption {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  status: LeadStatus
}

interface EnrollModalProps {
  sequenceId: string
  leads: LeadOption[]
  enrolledLeadIds: Set<string>
  onClose: () => void
  onEnrolled: () => void
}

export function EnrollModal({ sequenceId, leads, enrolledLeadIds, onClose, onEnrolled }: EnrollModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [enrolling, setEnrolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleLead(leadId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(leadId)) {
        next.delete(leadId)
      } else {
        next.add(leadId)
      }
      return next
    })
  }

  async function handleEnroll() {
    setEnrolling(true)
    setError(null)

    const res = await fetch(`/api/sequences/${sequenceId}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadIds: Array.from(selected) }),
    })

    setEnrolling(false)

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? 'Failed to enroll leads')
      return
    }

    onEnrolled()
  }

  return (
    <Dialog
      title="Enroll Leads"
      size="md"
      busy={enrolling}
      onClose={onClose}
      footer={
        <>
          {error && <p className="text-[var(--status-danger)] text-xs mb-2">{error}</p>}
          <Button
            variant="primary"
            size="sm"
            onClick={handleEnroll}
            disabled={enrolling || selected.size === 0}
          >
            {enrolling ? 'Enrolling\u2026' : `Enroll ${selected.size} Lead${selected.size !== 1 ? 's' : ''}`}
          </Button>
        </>
      }
    >
      <div className="px-5 py-4">
        <div className="space-y-1">
          {leads.map((lead) => {
            const isTerminal = TERMINAL_STATUSES.includes(lead.status)
            const isEnrolled = enrolledLeadIds.has(lead.id)
            const disabled = isTerminal || isEnrolled
            const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email

            return (
              <label
                key={lead.id}
                className={`flex items-center gap-3 px-3 py-2 rounded-[var(--radius-btn)] transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[var(--bg-surface-raised)] cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(lead.id)}
                  onChange={() => !disabled && toggleLead(lead.id)}
                  disabled={disabled}
                  className="accent-[var(--accent-indigo)]"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[var(--text-primary)] text-sm truncate">{name}</p>
                  <p className="text-[var(--text-muted)] text-xs truncate">{lead.email}</p>
                </div>
                {isTerminal && <span className="text-[var(--text-muted)] text-xs">Terminal</span>}
                {isEnrolled && <span className="text-[var(--text-muted)] text-xs">Enrolled</span>}
              </label>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
