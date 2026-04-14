'use client'

import { RefreshCw, Radio } from 'lucide-react'

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
      <div className="flex gap-0.5 bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-btn)] p-0.5">
        {(['7d', '30d'] as const).map((range) => (
          <button
            key={range}
            onClick={() => onDateRangeChange(range)}
            className={[
              'px-3 py-1.5 rounded-[calc(var(--radius-btn)-2px)] text-xs font-medium cursor-pointer',
              'transition-all duration-[var(--transition-base)]',
              dateRange === range
                ? 'bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
            ].join(' ')}
          >
            {range === '7d' ? '7 days' : '30 days'}
          </button>
        ))}
      </div>

      {/* Timestamp */}
      <span className="text-[var(--text-muted)] text-xs tabular-nums">
        Updated {timeStr}
      </span>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {/* Live toggle */}
        <button
          onClick={onLiveToggle}
          className={[
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-btn)] text-xs font-medium cursor-pointer',
            'transition-all duration-[var(--transition-base)]',
            isLive
              ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]'
              : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)]',
          ].join(' ')}
          aria-label={isLive ? 'Disable live updates' : 'Enable live updates'}
        >
          <Radio size={12} className={isLive ? 'animate-pulse' : ''} aria-hidden="true" />
          Live
        </button>

        {/* Refresh */}
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="p-1.5 rounded-[var(--radius-btn)] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface-raised)] transition-all duration-[var(--transition-base)] disabled:opacity-40 cursor-pointer"
          aria-label="Refresh dashboard"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
