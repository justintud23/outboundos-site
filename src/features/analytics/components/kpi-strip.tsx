'use client'

import type { AnalyticsDTO } from '../types'

interface KpiChipProps {
  label: string
  value: number
  accent: string
  index: number
}

function KpiChip({ label, value, accent, index }: KpiChipProps) {
  return (
    <div
      className="flex items-center gap-3 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-full px-4 py-2 shadow-[var(--shadow-card)]"
      style={{
        borderLeftWidth: 3,
        borderLeftColor: accent,
        animationDelay: `${index * 80}ms`,
      }}
    >
      <div>
        <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wide font-medium">{label}</p>
        <p className="text-[var(--text-primary)] text-lg font-semibold tabular-nums">{value.toLocaleString()}</p>
      </div>
    </div>
  )
}

export function KpiStrip({ analytics }: { analytics: AnalyticsDTO }) {
  const chips = [
    { label: 'Sent', value: analytics.sent, accent: 'var(--accent-indigo)' },
    { label: 'Delivered', value: analytics.delivered, accent: 'var(--accent-cyan)' },
    { label: 'Opened', value: analytics.opened, accent: 'var(--accent-magenta)' },
    { label: 'Clicked', value: analytics.clicked, accent: 'var(--accent-cyan)' },
    { label: 'Replies', value: analytics.replies, accent: 'var(--status-success)' },
    { label: 'Positive', value: analytics.positiveReplies, accent: 'var(--status-success)' },
    { label: 'Bounced', value: analytics.bounced, accent: 'var(--status-danger)' },
    { label: 'Unsubs', value: analytics.unsubscribes, accent: 'var(--status-danger)' },
  ]

  return (
    <div className="flex flex-wrap gap-3">
      {chips.map((chip, i) => (
        <KpiChip key={chip.label} {...chip} index={i} />
      ))}
    </div>
  )
}
