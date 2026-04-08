'use client'

import { useState } from 'react'
import { SequenceCard } from '@/features/sequences/components/sequence-card'
import { CreateSequenceForm } from '@/features/sequences/components/create-sequence-form'
import type { SequenceDTO } from '@/features/sequences/types'

interface SequencesClientProps {
  initialSequences: SequenceDTO[]
  campaigns: { id: string; name: string }[]
}

export function SequencesClient({ initialSequences, campaigns }: SequencesClientProps) {
  const [sequences] = useState(initialSequences)
  const [showCreate, setShowCreate] = useState(false)

  function handleCreated() {
    setShowCreate(false)
    window.location.reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-[var(--text-secondary)] text-sm">
          {sequences.length} sequence{sequences.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-3 py-1.5 rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] text-white hover:bg-[var(--accent-indigo-hover)] transition-colors font-medium"
        >
          {showCreate ? 'Cancel' : 'Create Sequence'}
        </button>
      </div>

      {showCreate && campaigns.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5 shadow-[var(--shadow-card)]">
          <h3 className="text-[var(--text-primary)] text-sm font-medium mb-4">New Sequence</h3>
          <CreateSequenceForm campaigns={campaigns} onCreated={handleCreated} />
        </div>
      )}

      {showCreate && campaigns.length === 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5">
          <p className="text-[var(--text-muted)] text-sm">Create a campaign first before adding sequences.</p>
        </div>
      )}

      {sequences.length === 0 && !showCreate ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-[var(--text-muted)] text-sm">No sequences yet.</p>
          <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">
            Create a sequence to automate your outreach follow-ups.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {sequences.map((seq) => (
            <SequenceCard key={seq.id} sequence={seq} />
          ))}
        </div>
      )}
    </div>
  )
}
