export interface SendEmailInput {
  to: string
  fromEmail: string
  fromName: string
  subject: string
  body: string
  // SendGrid customArgs are attached to the message and echoed back in every
  // webhook event — use for webhook correlation and debugging.
  customArgs?: Record<string, string>
}

export interface SendEmailOutput {
  sgMessageId: string | null
}

export interface EmailProvider {
  sendEmail(input: SendEmailInput): Promise<SendEmailOutput>
}
