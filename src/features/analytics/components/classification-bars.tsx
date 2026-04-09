'use client'

import { LazyBarChart, LazyResponsiveContainer, XAxis, YAxis, Tooltip, Bar, Cell } from '@/components/charts/recharts-wrapper'
import { formatEnumLabel } from '@/lib/format'
import type { ClassificationBreakdownDTO } from '../types'
import type { ReplyClassification } from '@prisma/client'

const COLORS: Record<ReplyClassification, string> = {
  POSITIVE: 'var(--status-success)',
  NEGATIVE: 'var(--status-danger)',
  NEUTRAL: 'var(--text-secondary)',
  OUT_OF_OFFICE: 'var(--status-warning)',
  UNSUBSCRIBE_REQUEST: 'var(--status-danger)',
  REFERRAL: 'var(--accent-indigo)',
  UNKNOWN: 'var(--text-muted)',
}

export function ClassificationBars({ data, totalReplies }: { data: ClassificationBreakdownDTO[]; totalReplies: number }) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[var(--text-muted)] text-sm">No replies classified yet</p>
      </div>
    )
  }

  const chartData = data.map((d) => ({ ...d, label: formatEnumLabel(d.classification) }))

  return (
    <div>
      <p className="text-[var(--text-muted)] text-xs mb-3">
        {data.reduce((s, d) => s + d.count, 0)} classifications from {totalReplies} total replies
      </p>
      <LazyResponsiveContainer width="100%" height={240}>
        <LazyBarChart data={chartData} layout="vertical" margin={{ left: 100, right: 30 }}>
          <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
          <YAxis type="category" dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={95} />
          <Tooltip
            contentStyle={{ background: 'var(--bg-surface-overlay)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: 'var(--text-primary)' }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]}>
            {data.map((entry) => (
              <Cell key={entry.classification} fill={COLORS[entry.classification] ?? 'var(--text-muted)'} />
            ))}
          </Bar>
        </LazyBarChart>
      </LazyResponsiveContainer>
    </div>
  )
}
