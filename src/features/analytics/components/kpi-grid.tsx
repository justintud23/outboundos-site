import type { AnalyticsDTO } from '../types'

interface KpiGridProps {
  analytics: AnalyticsDTO
}

interface KpiCardProps {
  label: string
  value: number
  rate?: string
  accent?: 'success' | 'danger'
}

function pct(numerator: number, denominator: number): string | undefined {
  if (denominator === 0) return undefined
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

function KpiCard({ label, value, rate, accent }: KpiCardProps) {
  const valueColor =
    accent === 'success'
      ? 'text-[#10b981]'
      : accent === 'danger'
        ? 'text-[#ef4444]'
        : 'text-[#e2e8f0]'

  return (
    <div className="bg-[#13151c] border border-[#1e2130] rounded-lg p-5">
      <p className="text-[#475569] text-xs uppercase tracking-wide font-medium mb-2">{label}</p>
      <p className={`text-3xl font-semibold tabular-nums ${valueColor}`}>{value.toLocaleString()}</p>
      {rate !== undefined && (
        <p className="text-[#475569] text-xs mt-1">{rate} rate</p>
      )}
    </div>
  )
}

export function KpiGrid({ analytics }: KpiGridProps) {
  const { sent, delivered, opened, clicked, replies, positiveReplies, bounced, unsubscribes } = analytics

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard label="Sent"             value={sent} />
      <KpiCard label="Delivered"        value={delivered}       rate={pct(delivered, sent)} />
      <KpiCard label="Opened"           value={opened}          rate={pct(opened, sent)}          accent="success" />
      <KpiCard label="Clicked"          value={clicked}         rate={pct(clicked, sent)}          accent="success" />
      <KpiCard label="Replies"          value={replies} />
      <KpiCard label="Positive Replies" value={positiveReplies} rate={pct(positiveReplies, replies)} accent="success" />
      <KpiCard label="Bounced"          value={bounced}         rate={pct(bounced, sent)}          accent="danger" />
      <KpiCard label="Unsubscribes"     value={unsubscribes}    rate={pct(unsubscribes, sent)}     accent="danger" />
    </div>
  )
}
