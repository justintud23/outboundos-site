'use client'

import { useState } from 'react'
import type { ReplyClassification } from '@prisma/client'
import { RepliesTable } from '@/features/replies/components/replies-table'
import type { ReplyWithLeadDTO } from '@/features/replies/types'

const ALL_CLASSIFICATIONS: ReplyClassification[] = [
  'POSITIVE',
  'NEUTRAL',
  'NEGATIVE',
  'OUT_OF_OFFICE',
  'UNSUBSCRIBE_REQUEST',
  'REFERRAL',
  'UNKNOWN',
]

const CLASSIFICATION_LABELS: Record<ReplyClassification, string> = {
  POSITIVE:            'Positive',
  NEUTRAL:             'Neutral',
  NEGATIVE:            'Negative',
  OUT_OF_OFFICE:       'Out of Office',
  UNSUBSCRIBE_REQUEST: 'Unsubscribe',
  REFERRAL:            'Referral',
  UNKNOWN:             'Unknown',
}

interface RepliesClientProps {
  initialReplies: ReplyWithLeadDTO[]
  initialTotal: number
}

export function RepliesClient({ initialReplies, initialTotal }: RepliesClientProps) {
  const [filter, setFilter] = useState<ReplyClassification | 'ALL'>('ALL')

  const filtered =
    filter === 'ALL'
      ? initialReplies
      : initialReplies.filter((r) => r.classification === filter)

  const displayCount = filter === 'ALL' ? initialTotal : filtered.length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <span className="text-[#94a3b8] text-sm">
          {displayCount.toLocaleString()} repl{displayCount !== 1 ? 'ies' : 'y'}
        </span>

        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as ReplyClassification | 'ALL')}
          className="bg-[#1a1d2e] border border-[#2a2d3e] text-[#e2e8f0] text-xs rounded px-3 py-1.5 focus:outline-none focus:border-[#6366f1]"
        >
          <option value="ALL">All Classifications</option>
          {ALL_CLASSIFICATIONS.map((c) => (
            <option key={c} value={c}>
              {CLASSIFICATION_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-[#13151c] border border-[#1e2130] rounded-lg overflow-hidden">
        <RepliesTable replies={filtered} />
      </div>
    </div>
  )
}
