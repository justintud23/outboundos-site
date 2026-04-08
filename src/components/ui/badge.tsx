import { clsx } from 'clsx'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'muted'
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  return (
    <span
      className={clsx(
        `inline-flex items-center px-2 py-0.5 rounded-[var(--radius-badge)] text-xs font-medium`,
        {
          'bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)]': variant === 'default',
          'bg-[var(--status-success-bg)] text-[var(--status-success)]': variant === 'success',
          'bg-[var(--status-warning-bg)] text-[var(--status-warning)]': variant === 'warning',
          'bg-[var(--status-danger-bg)] text-[var(--status-danger)]': variant === 'danger',
          'bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]': variant === 'muted',
        },
      )}
    >
      {children}
    </span>
  )
}
