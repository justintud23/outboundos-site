import type { EmailProvider, SendEmailInput, SendEmailOutput } from '../provider'
import { createDraftMessage, createReplyDraft, sendDraftMessage } from './mail'

// Graph can't set List-Unsubscribe (only X- headers are allowed), so the
// unsubscribe intent is carried as a plain link at the end of the body.
export function appendUnsubscribeFooter(body: string, lu?: { url: string }): string {
  if (!lu) return body
  return `${body.trimEnd()}\n\n--\nIf you'd prefer not to hear from me again, unsubscribe here: ${lu.url}`
}

export class GraphEmailProvider implements EmailProvider {
  constructor(private readonly tenantId: string) {}

  async sendEmail(input: SendEmailInput): Promise<SendEmailOutput> {
    const content = {
      to: input.to,
      subject: input.subject,
      text: appendUnsubscribeFooter(input.body, input.listUnsubscribe),
    }
    const draft = input.replyToProviderMessageId
      ? await createReplyDraft(this.tenantId, input.fromEmail, input.replyToProviderMessageId, content)
      : await createDraftMessage(this.tenantId, input.fromEmail, content)

    // Persist the id BEFORE sending: if we crash after /send, the next attempt
    // finds it in Sent Items instead of sending twice.
    if (input.onPrepared) await input.onPrepared(draft.id)

    await sendDraftMessage(this.tenantId, input.fromEmail, draft.id)
    return { sgMessageId: null, providerMessageId: draft.id, conversationId: draft.conversationId }
  }
}
