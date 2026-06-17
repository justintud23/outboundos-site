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
  constructor() {
    super('Daily send limit reached for this mailbox.')
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

import type { LeadStatus } from '@prisma/client'

export class LeadInTerminalStateError extends Error {
  constructor(public readonly leadId: string, public readonly status: LeadStatus) {
    super(`Cannot send to lead ${leadId} in terminal state: ${status}`)
    this.name = 'LeadInTerminalStateError'
    Object.setPrototypeOf(this, LeadInTerminalStateError.prototype)
  }
}
