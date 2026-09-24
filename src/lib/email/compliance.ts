// CAN-SPAM footer: every commercial email must identify the sender, carry a
// valid physical postal address, and offer a working opt-out. Rendered into the
// body by every provider, so it doesn't depend on List-Unsubscribe headers
// (which Microsoft Graph can't set).

export interface ComplianceSender {
  businessName: string | null
  postalAddress: string
}

export function buildComplianceFooter(
  body: string,
  sender: ComplianceSender | undefined,
  listUnsubscribe: { url: string } | undefined,
): string {
  const lines: string[] = []
  if (sender) {
    if (sender.businessName?.trim()) lines.push(sender.businessName.trim())
    lines.push(sender.postalAddress.trim())
  }
  if (listUnsubscribe) {
    lines.push(`If you'd prefer not to hear from me again, unsubscribe here: ${listUnsubscribe.url}`)
  }
  if (lines.length === 0) return body
  return `${body.trimEnd()}\n\n--\n${lines.join('\n')}`
}
