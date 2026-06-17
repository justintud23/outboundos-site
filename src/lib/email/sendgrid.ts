import sgMail from '@sendgrid/mail'
import type { EmailProvider, SendEmailInput, SendEmailOutput } from './provider'

// Map the provider-agnostic listUnsubscribe intent to RFC 8058 mail headers.
// List-Unsubscribe is a comma-separated list of angle-bracket-wrapped targets
// (https first, optional mailto); List-Unsubscribe-Post is the fixed token that
// opts the message into one-click unsubscribe.
function buildListUnsubscribeHeaders(
  listUnsubscribe: NonNullable<SendEmailInput['listUnsubscribe']>,
): Record<string, string> {
  const targets = [`<${listUnsubscribe.url}>`]
  if (listUnsubscribe.mailto) {
    targets.push(`<mailto:${listUnsubscribe.mailto}>`)
  }
  return {
    'List-Unsubscribe': targets.join(', '),
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}

export class SendGridProvider implements EmailProvider {
  constructor(apiKey: string) {
    sgMail.setApiKey(apiKey)
  }

  async sendEmail(input: SendEmailInput): Promise<SendEmailOutput> {
    const unsubscribeHeaders = input.listUnsubscribe
      ? buildListUnsubscribeHeaders(input.listUnsubscribe)
      : undefined

    const [response] = await sgMail.send({
      to: input.to,
      from: { email: input.fromEmail, name: input.fromName },
      subject: input.subject,
      text: input.body,
      // customArgs are echoed back in every SendGrid webhook event —
      // enables webhook-to-message correlation without a database lookup.
      ...(input.customArgs && { customArgs: input.customArgs }),
      ...(unsubscribeHeaders && { headers: unsubscribeHeaders }),
    })

    const headers = response.headers as Record<string, string>
    const sgMessageId = headers['x-message-id'] ?? null

    return { sgMessageId }
  }
}
