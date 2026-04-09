import type { DashboardSummaryDTO } from '@/features/dashboard/server/get-dashboard-summary'

export function KpiSummary({ data }: { data: DashboardSummaryDTO }) {
  const positiveRate =
    data.replies > 0
      ? `${((data.positiveReplies / data.replies) * 100).toFixed(1)}%`
      : '\u2014'

  const items = [
    { label: 'Leads', value: data.leads },
    { label: 'Campaigns', value: data.campaigns },
    { label: 'Sent', value: data.messagesSent },
    { label: 'Replies', value: data.replies, sub: `${positiveRate} positive` },
  ]

  return (
    <div className="grid grid-cols-2 gap-3">
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-[var(--text-muted)] text-[10px] uppercase tracking-wide font-medium">{item.label}</p>
          <p className="text-[var(--text-primary)] text-2xl font-semibold tabular-nums">{item.value.toLocaleString()}</p>
          {item.sub && <p className="text-[var(--text-muted)] text-[10px]">{item.sub}</p>}
        </div>
      ))}
    </div>
  )
}
