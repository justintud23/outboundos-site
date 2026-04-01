import { clsx } from 'clsx'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'muted'
}

export function Badge({ children, variant = 'default' }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        {
          'bg-[#1e1f3a] text-[#6366f1]': variant === 'default',
          'bg-[#052e16] text-[#10b981]': variant === 'success',
          'bg-[#2d1f00] text-[#f59e0b]': variant === 'warning',
          'bg-[#2d0f0f] text-[#ef4444]': variant === 'danger',
          'bg-[#1a1d2e] text-[#94a3b8]': variant === 'muted',
        },
      )}
    >
      {children}
    </span>
  )
}
