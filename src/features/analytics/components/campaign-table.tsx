'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { formatEnumLabel } from '@/lib/format'
import type { CampaignPerformanceDTO } from '../types'
import type { CampaignStatus } from '@prisma/client'

const STATUS_VARIANT: Record<CampaignStatus, 'default' | 'success' | 'warning' | 'muted'> = {
  DRAFT: 'muted',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'default',
  ARCHIVED: 'muted',
}

type SortKey = 'sent' | 'delivered' | 'opened' | 'replied' | 'openRate' | 'replyRate'

function InlineBar({ value, max }: { value: number; max: number }) {
  const width = max === 0 ? 0 : Math.min((value / max) * 100, 100)
  return (
    <div className="flex items-center gap-2">
      <span className="text-[var(--text-primary)] text-xs tabular-nums w-8 text-right">{value}</span>
      <div className="flex-1 h-1.5 bg-[var(--bg-surface-raised)] rounded-full overflow-hidden">
        <div
          className="h-full bg-[var(--chart-sent)] rounded-full transition-all duration-500"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  )
}

export function CampaignTable({ data }: { data: CampaignPerformanceDTO[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('sent')
  const [sortAsc, setSortAsc] = useState(false)

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[var(--text-muted)] text-sm">No campaigns with activity yet</p>
      </div>
    )
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc((v) => !v)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const sorted = [...data].sort((a, b) => {
    const diff = (a[sortKey] as number) - (b[sortKey] as number)
    return sortAsc ? diff : -diff
  })

  const maxSent = Math.max(...data.map((c) => c.sent), 1)

  function SortHeader({ label, field }: { label: string; field: SortKey }) {
    return (
      <th
        className="text-left py-3 px-3 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide cursor-pointer hover:text-[var(--text-secondary)] transition-colors select-none"
        onClick={() => handleSort(field)}
      >
        {label} {sortKey === field ? (sortAsc ? '\u2191' : '\u2193') : ''}
      </th>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-[var(--bg-surface)] z-10">
          <tr className="border-b border-[var(--border-default)]">
            <th className="text-left py-3 px-3 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Campaign</th>
            <th className="text-left py-3 px-3 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
            <SortHeader label="Sent" field="sent" />
            <SortHeader label="Delivered" field="delivered" />
            <SortHeader label="Opened" field="opened" />
            <SortHeader label="Replied" field="replied" />
            <SortHeader label="Positive %" field="replyRate" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((campaign, i) => (
            <tr
              key={campaign.id}
              className={[
                'border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]',
                i === 0 ? 'border-l-2 border-l-[var(--accent-indigo)]' : '',
              ].join(' ')}
            >
              <td className="py-3 px-3">
                <Link href={`/campaigns/${campaign.id}`} className="text-[var(--text-primary)] text-xs font-medium hover:text-[var(--accent-indigo-hover)] transition-colors">
                  {campaign.name}
                </Link>
              </td>
              <td className="py-3 px-3">
                <Badge variant={STATUS_VARIANT[campaign.status]}>{formatEnumLabel(campaign.status)}</Badge>
              </td>
              <td className="py-3 px-3"><InlineBar value={campaign.sent} max={maxSent} /></td>
              <td className="py-3 px-3"><InlineBar value={campaign.delivered} max={maxSent} /></td>
              <td className="py-3 px-3"><InlineBar value={campaign.opened} max={maxSent} /></td>
              <td className="py-3 px-3"><InlineBar value={campaign.replied} max={maxSent} /></td>
              <td className="py-3 px-3">
                <span className={`text-xs font-medium tabular-nums ${
                  campaign.replyRate >= 0.5 ? 'text-[var(--status-success)]' :
                  campaign.replyRate >= 0.25 ? 'text-[var(--status-warning)]' :
                  'text-[var(--status-danger)]'
                }`}>
                  {(campaign.replyRate * 100).toFixed(1)}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
