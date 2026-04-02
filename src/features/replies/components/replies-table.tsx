'use client'

import { Badge } from '@/components/ui/badge'
import type { ReplyClassification } from '@prisma/client'
import type { ReplyWithLeadDTO } from '../types'

interface RepliesTableProps {
  replies: ReplyWithLeadDTO[]
}

const CLASSIFICATION_LABELS: Record<ReplyClassification, string> = {
  POSITIVE:            'Positive',
  NEUTRAL:             'Neutral',
  NEGATIVE:            'Negative',
  OUT_OF_OFFICE:       'Out of Office',
  UNSUBSCRIBE_REQUEST: 'Unsubscribe',
  REFERRAL:            'Referral',
  UNKNOWN:             'Unknown',
}

function ClassificationBadge({ value }: { value: ReplyClassification }) {
  const variantMap: Record<ReplyClassification, 'success' | 'muted' | 'danger' | 'warning' | 'default'> = {
    POSITIVE:            'success',
    NEUTRAL:             'muted',
    NEGATIVE:            'danger',
    OUT_OF_OFFICE:       'warning',
    UNSUBSCRIBE_REQUEST: 'danger',
    REFERRAL:            'default',
    UNKNOWN:             'muted',
  }
  return <Badge variant={variantMap[value]}>{CLASSIFICATION_LABELS[value]}</Badge>
}

export function RepliesTable({ replies }: RepliesTableProps) {
  if (replies.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-[#94a3b8] text-sm">No replies yet.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#1e2130]">
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Lead</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Classification</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Confidence</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Preview</th>
            <th className="text-left py-3 px-4 text-[#475569] font-medium text-xs uppercase tracking-wide">Received</th>
          </tr>
        </thead>
        <tbody>
          {replies.map((reply) => (
            <tr
              key={reply.id}
              className={
                reply.classification === 'POSITIVE'
                  ? 'border-b border-[#1a1d2e] bg-[#052e16]/20 hover:bg-[#052e16]/40 transition-colors'
                  : 'border-b border-[#1a1d2e] hover:bg-[#1a1d2e] transition-colors'
              }
            >
              <td className="py-3 px-4 text-[#e2e8f0]">{reply.leadEmail}</td>
              <td className="py-3 px-4">
                <ClassificationBadge value={reply.classification} />
              </td>
              <td className="py-3 px-4 text-[#94a3b8] text-xs">
                {reply.classificationConfidence !== null
                  ? `${Math.round(reply.classificationConfidence * 100)}%`
                  : '—'}
              </td>
              <td className="py-3 px-4 text-[#475569] text-xs hidden lg:table-cell max-w-xs truncate">
                {reply.rawBody.slice(0, 120)}
              </td>
              <td className="py-3 px-4 text-[#94a3b8] text-xs">
                {new Date(reply.receivedAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
