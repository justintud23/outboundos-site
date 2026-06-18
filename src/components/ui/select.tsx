import { clsx } from 'clsx'

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>

/**
 * Styled native <select>. Mirrors the Input primitive's box treatment (surface
 * bg, border, focus ring, disabled) so form controls look consistent. Native
 * <select> keeps full keyboard/screen-reader accessibility for free. Width is
 * intentionally NOT forced — pass `className="w-full"` (or `flex-1`) where needed.
 */
export function Select({ className, children, ...props }: SelectProps) {
  return (
    <select
      className={clsx(
        'bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)]',
        'rounded-[var(--radius-btn)] px-3 py-2 text-sm',
        'focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)]',
        'transition-all duration-[var(--transition-base)]',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}
