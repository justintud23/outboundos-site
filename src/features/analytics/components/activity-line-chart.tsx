'use client'

import { LazyAreaChart, LazyResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Area, Legend } from '@/components/charts/recharts-wrapper'
import type { DailyActivityExtendedPoint } from '../types'

export function ActivityLineChart({ data }: { data: DailyActivityExtendedPoint[] }) {
  if (data.length === 0 || data.every((d) => d.sent === 0 && d.delivered === 0 && d.opened === 0 && d.replied === 0)) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[var(--text-muted)] text-sm">No activity in the selected period</p>
      </div>
    )
  }

  return (
    <LazyResponsiveContainer width="100%" height={320}>
      <LazyAreaChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis
          dataKey="date"
          tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
          tickFormatter={(v: string) => v.slice(5)}
        />
        <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} width={35} />
        <Tooltip
          contentStyle={{ background: 'var(--bg-surface-overlay)', border: '1px solid var(--border-default)', borderRadius: 8, fontSize: 12 }}
          labelStyle={{ color: 'var(--text-primary)' }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: 'var(--text-secondary)' }} />
        <Area type="monotone" dataKey="sent" stroke="var(--accent-indigo)" fill="var(--accent-indigo)" fillOpacity={0.12} strokeWidth={2} name="Sent" />
        <Area type="monotone" dataKey="delivered" stroke="var(--accent-cyan)" fill="var(--accent-cyan)" fillOpacity={0.08} strokeWidth={2} name="Delivered" />
        <Area type="monotone" dataKey="opened" stroke="var(--accent-magenta)" fill="var(--accent-magenta)" fillOpacity={0.08} strokeWidth={2} name="Opened" />
        <Area type="monotone" dataKey="replied" stroke="var(--status-success)" fill="var(--status-success)" fillOpacity={0.08} strokeWidth={2} name="Replied" />
      </LazyAreaChart>
    </LazyResponsiveContainer>
  )
}
