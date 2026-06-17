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
}

export interface SendEmailOutput {
  sgMessageId: string | null
}

export interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<SendEmailOutput>
}
