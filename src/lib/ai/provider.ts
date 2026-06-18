export interface LeadScoreInput {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  title?: string | null
}

export interface LeadScoreOutput {
  leadId: string
  score: number | null // 0–100, or null when scoring failed (explicit "unscored")
  reason: string
}

export interface EmailDraftInput {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  company?: string | null
  title?: string | null
}

export interface EmailDraftOutput {
  subject: string
  body: string
}

export interface ReplyClassifyInput {
  rawBody: string
}

export type ReplyClassificationValue =
  | 'POSITIVE'
  | 'NEUTRAL'
  | 'NEGATIVE'
  | 'OUT_OF_OFFICE'
  | 'UNSUBSCRIBE_REQUEST'
  | 'REFERRAL'
  | 'UNKNOWN'

export interface ReplyClassifyOutput {
  classification: ReplyClassificationValue
  confidence: number  // 0–1
}

/**
 * Thrown when AI email-draft generation fails (transport error after retries, or
 * the model returned unusable output). draftEmail SURFACES this rather than
 * returning an empty/garbage draft — callers must not persist a useless draft.
 */
export class DraftGenerationError extends Error {
  constructor(
    message = 'AI draft generation failed. Please try again.',
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'DraftGenerationError'
    Object.setPrototypeOf(this, DraftGenerationError.prototype)
  }
}

export interface AIProvider {
  scoreLeads(
    leads: LeadScoreInput[],
    promptTemplate: string,
  ): Promise<LeadScoreOutput[]>

  draftEmail(
    lead: EmailDraftInput,
    promptTemplate: string,
  ): Promise<EmailDraftOutput>

  classifyReply(
    input: ReplyClassifyInput,
    promptTemplate: string,
  ): Promise<ReplyClassifyOutput>
}
