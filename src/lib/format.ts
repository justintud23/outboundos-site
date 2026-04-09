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
