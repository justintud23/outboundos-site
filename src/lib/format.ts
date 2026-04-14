/**
 * Formats an enum value like "OUT_OF_OFFICE" or "NOT_INTERESTED"
 * into a human-readable label: "Out of Office", "Not Interested".
 *
 * Handles single words like "NEW" → "New" and multi-word like
 * "PENDING_REVIEW" → "Pending Review".
 */
export function formatEnumLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Returns a human-readable relative time string from a Date.
 * Works in both server (Node) and client (browser) contexts.
 */
export function relativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDays = Math.floor(diffHr / 24)
  if (diffDays === 1) return '1d ago'
  return `${diffDays}d ago`
}
