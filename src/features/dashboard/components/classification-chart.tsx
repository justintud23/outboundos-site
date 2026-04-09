'use client'

import { LazyBarChart, LazyResponsiveContainer, XAxis, YAxis, Tooltip, Bar, Cell } from '@/components/charts/recharts-wrapper'
import type { ClassificationBreakdownDTO } from '@/features/analytics/types'
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

export function ClassificationChart({ data }: { data: ClassificationBreakdownDTO[] }) {
  if (data.length === 0) {
    return <p className="text-[var(--text-muted)] text-xs text-center py-8">No replies classified yet</p>
  }

  const total = data.reduce((s, d) => s + d.count, 0)

  return (
    <div>
      <LazyResponsiveContainer width="100%" height={180}>
        <LazyBarChart data={data} layout="vertical" margin={{ left: 80, right: 30 }}>
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="classification" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} width={75} />
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
      <p className="text-[var(--text-muted)] text-[10px] text-center mt-1">{total} total replies</p>
    </div>
  )
}
