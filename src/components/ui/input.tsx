import { clsx } from 'clsx'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={clsx(
        'w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)]',
        `rounded-[var(--radius-btn)] px-3 py-2 text-sm`,
        'placeholder:text-[var(--text-muted)]',
        'focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)]',
        'transition-all duration-[var(--transition-base)]',
        className,
      )}
      {...props}
    />
  )
}
