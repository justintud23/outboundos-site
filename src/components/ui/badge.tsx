import { clsx } from 'clsx'
import { CheckCircle2, AlertCircle, AlertTriangle, Minus } from 'lucide-react'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'muted'
  showIcon?: boolean
}

const VARIANT_ICONS = {
  default: null,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
  muted: Minus,
}

export function Badge({ children, variant = 'default', showIcon = false }: BadgeProps) {
  const Icon = showIcon ? VARIANT_ICONS[variant] : null

  return (
    <span
      className={clsx(
        `inline-flex items-center gap-1 px-2 py-0.5 rounded-[var(--radius-badge)] text-xs font-medium`,
        {
          'bg-[var(--accent-indigo-glow)] text-[var(--accent-indigo)]': variant === 'default',
          'bg-[var(--status-success-bg)] text-[var(--status-success)]': variant === 'success',
          'bg-[var(--status-warning-bg)] text-[var(--status-warning)]': variant === 'warning',
          'bg-[var(--status-danger-bg)] text-[var(--status-danger)]': variant === 'danger',
          'bg-[var(--bg-surface-raised)] text-[var(--text-secondary)]': variant === 'muted',
        },
      )}
    >
      {Icon && <Icon size={12} aria-hidden="true" className="flex-shrink-0" />}
      {children}
    </span>
  )
}
