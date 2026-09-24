// Classifies a message that arrived in a sending mailbox's Inbox. Order
// matters: NDRs often also carry Auto-Submitted, so BOUNCE is checked first.

export interface InboundMessage {
  fromAddress: string
  subject: string
  bodyText: string
  headers: Record<string, string> // names lower-cased
}

export type InboundKind = 'INTERNAL' | 'BOUNCE' | 'AUTO_REPLY' | 'HUMAN'

const BOUNCE_SENDER = /^(postmaster|mailer-daemon|microsoftexchange[0-9a-f]*)@/i
const BOUNCE_SUBJECT =
  /^\s*(undeliverable|undelivered mail returned to sender|delivery status notification \(failure\)|mail delivery failed|returned mail|delivery has failed|failure notice)/i
const AUTO_SUBJECT = /^\s*(automatic reply|auto[- ]?reply|autoreply|out of (the )?office)/i
const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

export function classifyInboundMessage(msg: InboundMessage, ownAddresses: ReadonlySet<string>): InboundKind {
  const from = msg.fromAddress.trim().toLowerCase()
  const own = new Set([...ownAddresses].map((a) => a.toLowerCase()))
  if (own.has(from)) return 'INTERNAL'

  const contentType = msg.headers['content-type'] ?? ''
  if (
    BOUNCE_SENDER.test(from) ||
    BOUNCE_SUBJECT.test(msg.subject) ||
    (/multipart\/report/i.test(contentType) && /delivery-status/i.test(contentType))
  ) {
    return 'BOUNCE'
  }

  const autoSubmitted = msg.headers['auto-submitted']
  if (
    (autoSubmitted !== undefined && autoSubmitted.trim().toLowerCase() !== 'no') ||
    'x-autoreply' in msg.headers ||
    'x-autorespond' in msg.headers ||
    /^(auto_reply|bulk|junk)$/i.test((msg.headers['precedence'] ?? '').trim()) ||
    AUTO_SUBJECT.test(msg.subject)
  ) {
    return 'AUTO_REPLY'
  }

  return 'HUMAN'
}

export function extractBouncedRecipients(bodyText: string, ownAddresses: ReadonlySet<string>): string[] {
  const own = new Set([...ownAddresses].map((a) => a.toLowerCase()))
  const found = new Set<string>()
  for (const m of bodyText.match(EMAIL) ?? []) {
    const addr = m.toLowerCase()
    if (own.has(addr) || BOUNCE_SENDER.test(addr)) continue
    found.add(addr)
  }
  return [...found]
}
