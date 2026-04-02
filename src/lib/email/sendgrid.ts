import sgMail from '@sendgrid/mail'
import type { EmailProvider, SendEmailInput, SendEmailOutput } from './provider'

export class SendGridProvider implements EmailProvider {
  constructor(apiKey: string) {
    sgMail.setApiKey(apiKey)
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailOutput> {
    const [response] = await sgMail.send({
      to: input.to,
      from: { email: input.fromEmail, name: input.fromName },
      subject: input.subject,
      text: input.body,
      // customArgs are echoed back in every SendGrid webhook event —
      // enables webhook-to-message correlation without a database lookup.
      ...(input.customArgs && { customArgs: input.customArgs }),
    })

    const headers = response.headers as Record<string, string>
    const sgMessageId = headers['x-message-id'] ?? null

    return { sgMessageId }
  }
}
