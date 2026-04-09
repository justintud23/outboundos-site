'use client'

import { LazyAreaChart, LazyResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Area } from '@/components/charts/recharts-wrapper'
import type { DailyActivityPoint } from '@/features/analytics/types'

export function ActivityChart({ data }: { data: DailyActivityPoint[] }) {
  if (data.length === 0 || data.every((d) => d.sent === 0 && d.replied === 0)) {
    return <p className="text-[var(--text-muted)] text-xs text-center py-8">No activity in this period</p>
  }

  return (
    <LazyResponsiveContainer width="100%" height={200}>
      <LazyAreaChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} width={30} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-surface-overlay)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-primary)' }}
        />
        <Area type="monotone" dataKey="sent" stroke="var(--chart-sent)" fill="var(--chart-sent)" fillOpacity={0.15} strokeWidth={2} />
        <Area type="monotone" dataKey="replied" stroke="var(--chart-replied)" fill="var(--chart-replied)" fillOpacity={0.15} strokeWidth={2} />
      </LazyAreaChart>
    </LazyResponsiveContainer>
  )
}
