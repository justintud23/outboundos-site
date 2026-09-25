import type { ItemResult } from './campaign-content'
import type { Severity } from './check-content'

export class ContentHighRiskError extends Error {
  constructor(public readonly items: ItemResult[]) {
    super(
      `High spam risk in ${items.map((i) => i.label).join(', ')}. Fix the flagged content, or record an override on the campaign page.`,
    )
    this.name = 'ContentHighRiskError'
    Object.setPrototypeOf(this, ContentHighRiskError.prototype)
  }
}

export class ContentOverrideValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContentOverrideValidationError'
    Object.setPrototypeOf(this, ContentOverrideValidationError.prototype)
  }
}

export interface ContentStatusDTO {
  level: Severity
  items: ItemResult[]
  override: { reason: string; by: string | null; at: string; valid: boolean } | null
}
