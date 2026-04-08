import { clsx } from 'clsx'

type ButtonBaseProps = {
  variant?: 'primary' | 'ghost' | 'outline'
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
    'inline-flex items-center justify-center font-medium transition-all duration-[var(--transition-base)]',
    `rounded-[var(--radius-btn)]`,
    'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
    {
      'bg-[var(--accent-indigo)] text-white hover:bg-[var(--accent-indigo-hover)] shadow-[0_0_12px_rgba(99,102,241,0.15)]': variant === 'primary',
      'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-raised)]': variant === 'ghost',
      'border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--accent-indigo)] hover:text-[var(--text-primary)]': variant === 'outline',
      'px-3 py-1.5 text-sm': size === 'sm',
      'px-4 py-2 text-sm': size === 'md',
      'opacity-50 cursor-not-allowed': disabled,
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
