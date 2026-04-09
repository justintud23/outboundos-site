import type { PromptType } from '@prisma/client'

export interface TemplateDTO {
  id: string
  name: string
  promptType: PromptType
  version: number
  body: string
  isActive: boolean
  notes: string | null
  createdAt: Date
  updatedAt: Date
}

export class TemplateNotFoundError extends Error {
  constructor(public readonly templateId: string) {
    super(`Template not found: ${templateId}`)
    this.name = 'TemplateNotFoundError'
    Object.setPrototypeOf(this, TemplateNotFoundError.prototype)
  }
}
