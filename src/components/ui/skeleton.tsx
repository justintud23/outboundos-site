export function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="bg-[var(--bg-surface-raised)] rounded-[var(--radius-btn)] animate-pulse"
      style={{ height }}
    />
  )
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-10 bg-[var(--bg-surface-raised)] rounded-[var(--radius-btn)] animate-pulse" />
      ))}
    </div>
  )
}
