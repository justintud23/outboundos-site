import { StatCard } from '@/components/ui/stat-card'
import type { AnalyticsDTO } from '../types'

interface KpiGridProps {
  analytics: AnalyticsDTO
}

function pct(numerator: number, denominator: number): string | undefined {
  if (denominator === 0) return undefined
  return `${((numerator / denominator) * 100).toFixed(1)}%`
}

export function KpiGrid({ analytics }: KpiGridProps) {
  const { sent, delivered, opened, clicked, replies, positiveReplies, bounced, unsubscribes } = analytics

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard label="Sent"             value={sent} />
      <StatCard label="Delivered"        value={delivered}       sub={pct(delivered, sent) ? `${pct(delivered, sent)} rate` : undefined} />
      <StatCard label="Opened"           value={opened}          sub={pct(opened, sent) ? `${pct(opened, sent)} rate` : undefined}          accent="success" />
      <StatCard label="Clicked"          value={clicked}         sub={pct(clicked, sent) ? `${pct(clicked, sent)} rate` : undefined}          accent="cyan" />
      <StatCard label="Replies"          value={replies} />
      <StatCard label="Positive Replies" value={positiveReplies} sub={pct(positiveReplies, replies) ? `${pct(positiveReplies, replies)} rate` : undefined} accent="success" />
      <StatCard label="Bounced"          value={bounced}         sub={pct(bounced, sent) ? `${pct(bounced, sent)} rate` : undefined}          accent="danger" />
      <StatCard label="Unsubscribes"     value={unsubscribes}    sub={pct(unsubscribes, sent) ? `${pct(unsubscribes, sent)} rate` : undefined}     accent="danger" />
    </div>
  )
}
