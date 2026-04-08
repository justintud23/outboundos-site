import { clsx } from 'clsx'

interface StatCardProps {
  label: string
  value: number
  sub?: string
  accent?: 'success' | 'warning' | 'danger' | 'cyan'
}

const ACCENT_COLORS: Record<string, string> = {
  success: 'border-l-[var(--status-success)]',
  warning: 'border-l-[var(--status-warning)]',
  danger: 'border-l-[var(--status-danger)]',
  cyan: 'border-l-[var(--accent-cyan)]',
}

const VALUE_COLORS: Record<string, string> = {
  success: 'text-[var(--status-success)]',
  warning: 'text-[var(--status-warning)]',
  danger: 'text-[var(--status-danger)]',
  cyan: 'text-[var(--accent-cyan)]',
}

export function StatCard({ label, value, sub, accent }: StatCardProps) {
  return (
    <div
      className={clsx(
        'bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5',
        'shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]',
        'transition-all duration-[var(--transition-base)]',
        accent && 'border-l-[3px]',
        accent && ACCENT_COLORS[accent],
      )}
    >
      <p className="text-[var(--text-muted)] text-xs uppercase tracking-wide font-medium mb-2">
        {label}
      </p>
      <p
        className={clsx(
          'text-3xl font-semibold tabular-nums',
          accent ? VALUE_COLORS[accent] : 'text-[var(--text-primary)]',
        )}
      >
        {value.toLocaleString()}
      </p>
      {sub !== undefined && (
        <p className="text-[var(--text-muted)] text-xs mt-1">{sub}</p>
      )}
    </div>
  )
}
