export interface MailboxDTO {
  id: string
  organizationId: string
  email: string
  displayName: string
  isActive: boolean
  dailyLimit: number
  sentToday: number
  createdAt: Date
  updatedAt: Date
}

export class MailboxAlreadyExistsError extends Error {
  constructor() {
    super('A mailbox with that email address already exists.')
    this.name = 'MailboxAlreadyExistsError'
  }
}
