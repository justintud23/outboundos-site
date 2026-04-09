'use client'

import { RefreshCw } from 'lucide-react'

interface SnapshotBarProps {
  lastUpdatedAt: Date
  dateRange: '7d' | '30d'
  isLive: boolean
  onRefresh: () => void
  onDateRangeChange: (range: '7d' | '30d') => void
  onLiveToggle: () => void
  refreshing: boolean
}

export function SnapshotBar({
  lastUpdatedAt,
  dateRange,
  isLive,
  onRefresh,
  onDateRangeChange,
  onLiveToggle,
  refreshing,
}: SnapshotBarProps) {
  const timeStr = lastUpdatedAt.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div className="flex items-center justify-between flex-wrap gap-3">
      {/* Date range pills */}
      <div className="flex gap-1">
        {(['7d', '30d'] as const).map((range) => (
          <button
            key={range}
            onClick={() => onDateRangeChange(range)}
            className={[
              'px-3 py-1.5 rounded-[var(--radius-btn)] text-xs font-medium transition-colors duration-[var(--transition-base)]',
              dateRange === range
                ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
            ].join(' ')}
          >
            {range === '7d' ? '7 days' : '30 days'}
          </button>
        ))}
      </div>

      {/* Timestamp */}
      <span className="text-[var(--text-muted)] text-xs">
        Last updated at {timeStr}
      </span>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* Live toggle */}
        <button
          onClick={onLiveToggle}
          className={[
            'flex items-center gap-1.5 px-2.5 py-1 rounded-[var(--radius-btn)] text-xs font-medium transition-colors',
            isLive
              ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
          ].join(' ')}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-[var(--status-success)] animate-pulse' : 'bg-[var(--text-muted)]'}`} />
          Live
        </button>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>
    </div>
  )
}
