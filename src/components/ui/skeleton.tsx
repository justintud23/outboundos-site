export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="animate-shimmer rounded-[var(--radius-card)]"
      style={{ height }}
      role="status"
      aria-label="Loading chart"
    >
      <span className="sr-only">Loading...</span>
    </div>
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading table">
      {/* Header row */}
      <div className="h-10 animate-shimmer rounded-[var(--radius-btn)]" />
      {/* Data rows with stagger effect */}
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-shimmer rounded-[var(--radius-btn)]"
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
      <span className="sr-only">Loading...</span>
    </div>
  )
}

export function StatCardSkeleton() {
  return (
    <div
      className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5"
      role="status"
      aria-label="Loading statistic"
    >
      <div className="h-3 w-20 animate-shimmer rounded mb-3" />
      <div className="h-8 w-16 animate-shimmer rounded mb-2" />
      <div className="h-3 w-24 animate-shimmer rounded" />
      <span className="sr-only">Loading...</span>
    </div>
  )
}
