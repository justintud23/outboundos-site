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
    this.name = 'PendingDraftExistsError'
  }
}

export class DraftNotPendingError extends Error {
  constructor(public readonly currentStatus: string) {
    super(`Draft is not pending review (status: ${currentStatus}).`)
    this.name = 'DraftNotPendingError'
  }
}

export class DraftNotFoundError extends Error {
  constructor() {
    super('Draft not found.')
    this.name = 'DraftNotFoundError'
  }
}
