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
  score: number      // 0–100
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
