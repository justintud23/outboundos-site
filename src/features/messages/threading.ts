import { randomUUID } from 'node:crypto'

// Email threading (RFC 5322): we generate our own Message-ID for every outbound
// email and use the chain of prior Message-IDs in the same sequence thread to set
// In-Reply-To / References on follow-ups, so step 2+ lands as a reply to step 1.

const MESSAGE_ID_DOMAIN_FALLBACK = 'outboundos.app'

/**
 * Domain used in the right-hand side of generated Message-IDs. It only needs to
 * be stable and globally unique-ish — it does NOT need to match the From domain
 * (Message-ID alignment is not a deliverability requirement). Derived from
 * NEXT_PUBLIC_APP_URL so it's consistent for a deployment.
 */
export function messageIdDomain(): string {
  const url = process.env.NEXT_PUBLIC_APP_URL
  if (url) {
    try {
      return new URL(url).host || MESSAGE_ID_DOMAIN_FALLBACK
    } catch {
      // fall through
    }
  }
  return MESSAGE_ID_DOMAIN_FALLBACK
}

/** Generate a fresh, angle-bracketed RFC 5322 Message-ID, e.g. <uuid@host>. */
export function generateMessageId(domain: string = messageIdDomain()): string {
  return `<${randomUUID()}@${domain}>`
}

/**
 * Strip any leading "Re:" prefixes (case-insensitive, possibly repeated/spaced)
 * so we never double-prefix.
 */
export function stripRePrefix(subject: string): string {
  return subject.replace(/^(?:\s*re\s*:\s*)+/i, '').trim()
}

/** Build a threaded reply subject: "Re: <original>", never doubling "Re:". */
export function buildReplySubject(originalSubject: string): string {
  return `Re: ${stripRePrefix(originalSubject)}`
}

export interface ThreadHeaders {
  inReplyTo?: string
  references?: string[]
}

/**
 * Given the prior message-ids in a thread (oldest → newest), compute the
 * In-Reply-To (the immediately-prior message) and References (the full chain,
 * oldest → newest) per RFC 5322. Empty input → no threading headers (first send).
 */
export function buildThreadHeaders(priorMessageIds: string[]): ThreadHeaders {
  if (priorMessageIds.length === 0) {
    return {}
  }
  return {
    inReplyTo: priorMessageIds[priorMessageIds.length - 1],
    references: priorMessageIds,
  }
}
