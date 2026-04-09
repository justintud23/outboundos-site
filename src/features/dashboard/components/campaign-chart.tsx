'use client'

import { LazyBarChart, LazyResponsiveContainer, XAxis, YAxis, Tooltip, Bar, CartesianGrid } from '@/components/charts/recharts-wrapper'
import type { CampaignPerformanceDTO } from '@/features/analytics/types'

export function CampaignChart({ data }: { data: CampaignPerformanceDTO[] }) {
  if (data.length === 0) {
    return <p className="text-[var(--text-muted)] text-xs text-center py-8">Create a campaign to compare performance</p>
  }

  const top5 = data.slice(0, 5).map((c) => ({
    name: c.name.length > 15 ? c.name.slice(0, 15) + '\u2026' : c.name,
    sent: c.sent,
    replied: c.replied,
  }))

  return (
    <LazyResponsiveContainer width="100%" height={200}>
      <LazyBarChart data={top5} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis dataKey="name" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} width={30} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-surface-overlay)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-primary)' }}
        />
        <Bar dataKey="sent" fill="var(--chart-sent)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="replied" fill="var(--chart-replied)" radius={[4, 4, 0, 0]} />
      </LazyBarChart>
    </LazyResponsiveContainer>
  )
}
