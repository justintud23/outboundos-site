export interface SendEmailInput {
  to: string
  fromEmail: string
  fromName: string
  subject: string
  body: string
  // SendGrid customArgs are attached to the message and echoed back in every
  // webhook event — use for webhook correlation and debugging.
  customArgs?: Record<string, string>
  // Provider-agnostic one-click list-unsubscribe (RFC 8058). `url` must be an
  // https endpoint; `mailto` is an optional bare email address. We model the
  // intent here rather than raw mail headers so the EmailProvider interface
  // stays transport-neutral — each provider maps this to its own mechanism.
  listUnsubscribe?: { url: string; mailto?: string }
  // RFC 5322 threading. All angle-bracketed (e.g. "<id@host>"). `messageId` is
  // THIS email's Message-ID (we generate and control it). `inReplyTo` and
  // `references` thread a follow-up to prior emails: inReplyTo = the immediately
  // prior message, references = the full chain oldest→newest. Transport-neutral —
  // the provider maps these to the right mail headers.
  messageId?: string
  inReplyTo?: string
  references?: string[]
  // Provider-native threading (Microsoft Graph): reply to this previously sent
  // message via createReply, so Exchange sets In-Reply-To/References itself.
  // SendGrid ignores it and uses messageId/inReplyTo/references instead.
  replyToProviderMessageId?: string
  // Called after the provider has created the outgoing message but BEFORE it
  // is sent. The caller persists the id so a crash between send and DB write
  // can be reconciled without a duplicate send. SendGrid never calls it.
  onPrepared?: (providerMessageId: string) => Promise<void>
}

export interface SendEmailOutput {
  sgMessageId: string | null
  // Graph: immutable message id + conversation id (null/undefined for SendGrid).
  providerMessageId?: string | null
  conversationId?: string | null
}

export interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<SendEmailOutput>
}
