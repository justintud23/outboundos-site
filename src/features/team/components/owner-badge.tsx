interface OwnerBadgeProps {
  name: string | null
}

/** Renders a lead/campaign/thread's owner name, or "Unassigned" when there is none. */
export function OwnerBadge({ name }: OwnerBadgeProps) {
  return (
    <span className={name ? 'text-[var(--text-secondary)]' : 'text-[var(--text-muted)]'}>
      {name ?? 'Unassigned'}
    </span>
  )
}
