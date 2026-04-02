import type { ReplyClassification } from '@prisma/client'

export interface InboundReplyDTO {
  id: string
  organizationId: string
  leadId: string
  outboundMessageId: string | null
  rawBody: string
  classification: ReplyClassification
  classificationConfidence: number | null
  receivedAt: Date
  createdAt: Date
}

export interface ReplyWithLeadDTO extends InboundReplyDTO {
  leadEmail: string
}

export class LeadNotFoundByEmailError extends Error {
  constructor(public readonly email: string) {
    super(`No lead found with email: ${email}`)
    this.name = 'LeadNotFoundByEmailError'
    Object.setPrototypeOf(this, LeadNotFoundByEmailError.prototype)
  }
}
