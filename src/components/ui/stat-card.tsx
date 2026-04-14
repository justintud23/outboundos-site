import { clsx } from 'clsx'
import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: number
  sub?: string
  accent?: 'success' | 'warning' | 'danger' | 'cyan' | 'violet' | 'warm'
  icon?: LucideIcon
}

const ACCENT_COLORS: Record<string, string> = {
  success: 'border-l-[var(--status-success)]',
  warning: 'border-l-[var(--status-warning)]',
  danger: 'border-l-[var(--status-danger)]',
  cyan: 'border-l-[var(--accent-cyan)]',
  violet: 'border-l-[var(--accent-magenta)]',
  warm: 'border-l-[var(--accent-warm)]',
}

const VALUE_COLORS: Record<string, string> = {
  success: 'text-[var(--status-success)]',
  warning: 'text-[var(--status-warning)]',
  danger: 'text-[var(--status-danger)]',
  cyan: 'text-[var(--accent-cyan)]',
  violet: 'text-[var(--accent-magenta)]',
  warm: 'text-[var(--accent-warm)]',
}

const ICON_BG_COLORS: Record<string, string> = {
  success: 'bg-[var(--status-success-bg)] text-[var(--status-success)]',
  warning: 'bg-[var(--status-warning-bg)] text-[var(--status-warning)]',
  danger: 'bg-[var(--status-danger-bg)] text-[var(--status-danger)]',
  cyan: 'bg-[rgba(56,189,248,0.12)] text-[var(--accent-cyan)]',
  violet: 'bg-[rgba(167,139,250,0.12)] text-[var(--accent-magenta)]',
  warm: 'bg-[rgba(251,146,60,0.12)] text-[var(--accent-warm)]',
}

export function StatCard({ label, value, sub, accent, icon: Icon }: StatCardProps) {
  return (
    <div
      className={clsx(
        'bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-5',
        'shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-card-hover)]',
        'transition-all duration-[var(--transition-base)]',
        'animate-fade-in-up',
        accent && 'border-l-[3px]',
        accent && ACCENT_COLORS[accent],
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-wider font-medium mb-2">
            {label}
          </p>
          <p
            className={clsx(
              'text-3xl font-semibold tabular-nums tracking-tight',
              accent ? VALUE_COLORS[accent] : 'text-[var(--text-primary)]',
            )}
          >
            {value.toLocaleString()}
          </p>
          {sub !== undefined && (
            <p className="text-[var(--text-muted)] text-xs mt-1.5">{sub}</p>
          )}
        </div>
        {Icon && accent && (
          <div
            className={clsx(
              'w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0',
              ICON_BG_COLORS[accent] ?? 'bg-[var(--bg-surface-raised)] text-[var(--text-muted)]',
            )}
            aria-hidden="true"
          >
            <Icon size={20} />
          </div>
        )}
      </div>
    </div>
  )
}
