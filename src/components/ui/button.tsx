import { clsx } from 'clsx'

type ButtonBaseProps = {
  variant?: 'primary' | 'ghost' | 'outline' | 'danger'
  size?: 'sm' | 'md'
  className?: string
  children: React.ReactNode
  disabled?: boolean
}

type ButtonAsButton = ButtonBaseProps &
  React.ButtonHTMLAttributes<HTMLButtonElement> & { as?: 'button' }

type ButtonAsSpan = ButtonBaseProps &
  React.HTMLAttributes<HTMLSpanElement> & { as: 'span' }

type ButtonProps = ButtonAsButton | ButtonAsSpan

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  disabled,
  as: Tag = 'button',
  ...props
}: ButtonProps) {
  const classes = clsx(
    'inline-flex items-center justify-center font-medium cursor-pointer',
    'transition-all duration-[var(--transition-base)]',
    `rounded-[var(--radius-btn)]`,
    'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
    'active:scale-[0.97]',
    {
      'bg-[var(--accent-indigo)] text-[var(--text-inverse)] hover:bg-[var(--accent-indigo-hover)]': variant === 'primary',
      'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)]': variant === 'ghost',
      'border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]': variant === 'outline',
      'bg-[var(--status-danger-bg)] text-[var(--status-danger)] hover:bg-[var(--status-danger)] hover:text-[var(--text-inverse)]': variant === 'danger',
      'px-3 py-1.5 text-sm gap-1.5': size === 'sm',
      'px-4 py-2 text-sm gap-2': size === 'md',
      'opacity-40 cursor-not-allowed pointer-events-none': disabled,
    },
    className,
  )

  if (Tag === 'span') {
    return (
      <span className={classes} {...(props as React.HTMLAttributes<HTMLSpanElement>)}>
        {children}
      </span>
    )
  }

  return (
    <button
      className={classes}
      disabled={disabled}
      {...(props as React.ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  )
}
