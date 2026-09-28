export interface SenderFields {
  senderFirstName: string | null
  senderName: string | null
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Adds {senderFirstName} / {senderName} merge fields; real CSV columns win. */
export function withSenderFields<T extends { customFields?: unknown }>(lead: T, sender: SenderFields): T {
  const derived: Record<string, string> = {}
  if (sender.senderFirstName) derived.senderFirstName = sender.senderFirstName
  if (sender.senderName) derived.senderName = sender.senderName
  return { ...lead, customFields: { ...derived, ...asRecord(lead.customFields) } }
}
