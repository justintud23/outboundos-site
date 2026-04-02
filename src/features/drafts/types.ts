import type { Draft } from '@prisma/client'

export type DraftDTO = Pick<
  Draft,
  | 'id'
  | 'organizationId'
  | 'leadId'
  | 'subject'
  | 'body'
  | 'status'
  | 'promptTemplateId'
  | 'createdByClerkId'
  | 'approvedByClerkId'
  | 'approvedAt'
  | 'rejectedAt'
  | 'rejectionReason'
  | 'createdAt'
  | 'updatedAt'
>

export interface DraftWithLeadDTO extends DraftDTO {
  lead: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    company: string | null
  }
}

export class PendingDraftExistsError extends Error {
  constructor(public readonly draftId: string) {
    super('A pending draft already exists for this lead.')
    Object.setPrototypeOf(this, PendingDraftExistsError.prototype)
    this.name = 'PendingDraftExistsError'
  }
}

export class DraftNotPendingError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`Draft is not pending review (status: ${currentStatus}).`)
    Object.setPrototypeOf(this, DraftNotPendingError.prototype)
    this.name = 'DraftNotPendingError'
  }
}

export class DraftNotFoundError extends Error {
  constructor() {
    super('Draft not found.')
    Object.setPrototypeOf(this, DraftNotFoundError.prototype)
    this.name = 'DraftNotFoundError'
  }
}

export class LeadNotFoundError extends Error {
  constructor() {
    super('Lead not found.')
    Object.setPrototypeOf(this, LeadNotFoundError.prototype)
    this.name = 'LeadNotFoundError'
  }
}
