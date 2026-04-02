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

export interface AIProvider {
  scoreLeads(
    leads: LeadScoreInput[],
    promptTemplate: string,
  ): Promise<LeadScoreOutput[]>

  draftEmail(
    lead: EmailDraftInput,
    promptTemplate: string,
  ): Promise<EmailDraftOutput>
}
