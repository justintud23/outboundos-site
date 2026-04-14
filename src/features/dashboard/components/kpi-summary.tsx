import { Users, Megaphone, Send, MessageSquare } from 'lucide-react'
import type { DashboardSummaryDTO } from '@/features/dashboard/server/get-dashboard-summary'

export function KpiSummary({ data }: { data: DashboardSummaryDTO }) {
  const positiveRate =
    data.replies > 0
      ? `${((data.positiveReplies / data.replies) * 100).toFixed(1)}%`
      : '\u2014'

  const items = [
    { label: 'Leads', value: data.leads, icon: Users, color: 'text-[var(--accent-indigo)]' },
    { label: 'Campaigns', value: data.campaigns, icon: Megaphone, color: 'text-[var(--accent-cyan)]' },
    { label: 'Sent', value: data.messagesSent, icon: Send, color: 'text-[var(--accent-magenta)]' },
    { label: 'Replies', value: data.replies, sub: `${positiveRate} positive`, icon: MessageSquare, color: 'text-[var(--status-success)]' },
  ]

  return (
    <div className="grid grid-cols-2 gap-4">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div key={item.label} className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-[var(--bg-surface-raised)] flex items-center justify-center flex-shrink-0 mt-0.5">
              <Icon size={16} className={item.color} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[var(--text-muted)] text-[11px] uppercase tracking-wider font-medium">{item.label}</p>
              <p className="text-[var(--text-primary)] text-xl font-semibold tabular-nums leading-tight">{item.value.toLocaleString()}</p>
              {item.sub && <p className="text-[var(--text-muted)] text-[11px] mt-0.5">{item.sub}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
