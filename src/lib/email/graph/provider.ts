import type { EmailProvider, SendEmailInput, SendEmailOutput } from '../provider'
import { buildComplianceFooter } from '../compliance'
import { createDraftMessage, createReplyDraft, sendDraftMessage } from './mail'

export class GraphEmailProvider implements EmailProvider {
  constructor(private readonly tenantId: string) {}

  async sendEmail(input: SendEmailInput): Promise<SendEmailOutput> {
    const content = {
      to: input.to,
      subject: input.subject,
      text: buildComplianceFooter(input.body, input.sender, input.listUnsubscribe),
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
