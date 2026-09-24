import type { OutboundMessage } from '@prisma/client'

export type OutboundMessageDTO = Pick<
  OutboundMessage,
  | 'id'
  | 'organizationId'
  | 'leadId'
  | 'mailboxId'
  | 'campaignId'
  | 'draftId'
  | 'sgMessageId'
  | 'subject'
  | 'body'
  | 'status'
  | 'sentAt'
  | 'createdAt'
  | 'updatedAt'
>

export class DraftNotApprovedError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`Draft is not approved (status: ${currentStatus}).`)
    this.name = 'DraftNotApprovedError'
    Object.setPrototypeOf(this, DraftNotApprovedError.prototype)
  }
}

export class NoActiveMailboxError extends Error {
  constructor() {
    super('No active mailbox configured for this organization.')
    this.name = 'NoActiveMailboxError'
    Object.setPrototypeOf(this, NoActiveMailboxError.prototype)
  }
}

export class MailboxLimitExceededError extends Error {
  constructor(message = 'Daily send limit reached for this mailbox.') {
    super(message)
    this.name = 'MailboxLimitExceededError'
    Object.setPrototypeOf(this, MailboxLimitExceededError.prototype)
  }
}

export class DraftAlreadySentError extends Error {
  constructor(public readonly messageId?: string) {
    super('This draft has already been sent.')
    this.name = 'DraftAlreadySentError'
    Object.setPrototypeOf(this, DraftAlreadySentError.prototype)
  }
}

// Raised when a send for this draft is already claimed and in flight: a QUEUED
// OutboundMessage row exists whose claim is still fresh (another invocation is
// mid-send). Distinct from DraftAlreadySentError, which means a send already
// COMPLETED. A caller seeing this should not retry immediately.
export class DraftSendInProgressError extends Error {
  constructor() {
    super('A send for this draft is already in progress.')
    this.name = 'DraftSendInProgressError'
    Object.setPrototypeOf(this, DraftSendInProgressError.prototype)
  }
}

// Raised when a manual send targets a draft that belongs to the automatic send
// queue (its OutboundMessage has a scheduledFor). The queue owns that message:
// a manual send must never touch it — a QUEUED one will go out on its own, a
// FAILED one is retried via POST /api/messages/[id]/retry.
export class DraftOnSendQueueError extends Error {
  constructor(public readonly messageStatus: string, public readonly messageId: string) {
    super(
      messageStatus === 'QUEUED'
        ? 'This draft is queued for automatic sending.'
        : messageStatus === 'FAILED'
          ? 'Automatic sending failed for this draft — use Retry.'
          : `This draft was handled by automatic sending (status: ${messageStatus}).`,
    )
    this.name = 'DraftOnSendQueueError'
    Object.setPrototypeOf(this, DraftOnSendQueueError.prototype)
  }
}

export class MessageNotFoundError extends Error {
  constructor() {
    super('Message not found.')
    this.name = 'MessageNotFoundError'
    Object.setPrototypeOf(this, MessageNotFoundError.prototype)
  }
}

export class MessageNotFailedError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`Only failed messages can be retried (status: ${currentStatus}).`)
    this.name = 'MessageNotFailedError'
    Object.setPrototypeOf(this, MessageNotFailedError.prototype)
  }
}

import type { LeadStatus } from '@prisma/client'

export class LeadInTerminalStateError extends Error {
  constructor(public readonly leadId: string, public readonly status: LeadStatus) {
    super(`Cannot send to lead ${leadId} in terminal state: ${status}`)
    this.name = 'LeadInTerminalStateError'
    Object.setPrototypeOf(this, LeadInTerminalStateError.prototype)
  }
}

// CAN-SPAM: a commercial email must carry the sender's physical postal address.
// Nothing sends until the organization has one (Settings → Sending).
export class MissingPostalAddressError extends Error {
  constructor() {
    super('Add your business mailing address in Settings before sending. US law (CAN-SPAM) requires it in every email.')
    this.name = 'MissingPostalAddressError'
    Object.setPrototypeOf(this, MissingPostalAddressError.prototype)
  }
}
