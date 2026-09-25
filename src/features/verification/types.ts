export interface VerificationSummaryDTO {
  configured: boolean
  pending: number
  risky: number
  invalid: number
  pausedReason: string | null
}
