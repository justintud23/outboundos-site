import type { EnrollmentStatus } from '@prisma/client'

// ─── Sequence DTOs ──────────────────────────────────────────

export interface SubjectVariantDTO {
  id: string
  subject: string
  isArchived: boolean
}

export interface SequenceStepDTO {
  id: string
  stepNumber: number
  subject: string
  body: string
  delayDays: number
  // A/B subject test (first step only). Empty when there is no test.
  variants: SubjectVariantDTO[]
  winningVariantId: string | null
}

// ─── Subject-variant A/B test results (DERIVED stats) ───────

export interface SubjectVariantStatDTO {
  id: string
  subject: string
  isArchived: boolean
  isWinner: boolean
  sent: number
  opened: number
  replied: number
  openRate: number
  replyRate: number
}

export interface SubjectVariantTestDTO {
  sequenceStepId: string
  hasTest: boolean
  winningVariantId: string | null
  variants: SubjectVariantStatDTO[]
}

export interface SequenceDTO {
  id: string
  organizationId: string
  campaignId: string
  name: string
  stepCount: number
  activeEnrollments: number
  completedEnrollments: number
  stoppedEnrollments: number
  createdAt: Date
}

export interface SequenceDetailDTO extends SequenceDTO {
  steps: SequenceStepDTO[]
  campaignName: string
}

// ─── Enrollment DTOs ────────────────────────────────────────

export interface EnrollmentDTO {
  id: string
  leadId: string
  leadEmail: string
  leadName: string
  currentStepNumber: number
  totalSteps: number
  status: EnrollmentStatus
  nextDueAt: Date | null
  startedAt: Date
  stoppedReason: string | null
}

// ─── Step execution result ──────────────────────────────────

export type StepResult = 'DRAFT_GENERATED' | 'COMPLETED' | 'STOPPED' | 'SKIPPED' | 'ERROR'

// ─── Errors ─────────────────────────────────────────────────

export class SequenceNotFoundError extends Error {
  constructor(public readonly sequenceId: string) {
    super(`Sequence not found: ${sequenceId}`)
    this.name = 'SequenceNotFoundError'
    Object.setPrototypeOf(this, SequenceNotFoundError.prototype)
  }
}

export class SequenceHasNoStepsError extends Error {
  constructor(public readonly sequenceId: string) {
    super(`Sequence ${sequenceId} has no steps`)
    this.name = 'SequenceHasNoStepsError'
    Object.setPrototypeOf(this, SequenceHasNoStepsError.prototype)
  }
}

export class AlreadyEnrolledError extends Error {
  constructor(public readonly sequenceId: string, public readonly leadId: string) {
    super(`Lead ${leadId} is already enrolled in sequence ${sequenceId}`)
    this.name = 'AlreadyEnrolledError'
    Object.setPrototypeOf(this, AlreadyEnrolledError.prototype)
  }
}

export class EnrollmentNotFoundError extends Error {
  constructor(public readonly enrollmentId: string) {
    super(`Enrollment not found: ${enrollmentId}`)
    this.name = 'EnrollmentNotFoundError'
    Object.setPrototypeOf(this, EnrollmentNotFoundError.prototype)
  }
}

export class SequenceHasActiveEnrollmentsError extends Error {
  constructor(public readonly sequenceId: string) {
    super(`Cannot modify sequence ${sequenceId} — it has active enrollments`)
    this.name = 'SequenceHasActiveEnrollmentsError'
    Object.setPrototypeOf(this, SequenceHasActiveEnrollmentsError.prototype)
  }
}

export class SubjectVariantStepNotFoundError extends Error {
  constructor(public readonly sequenceStepId: string) {
    super(`Sequence step not found: ${sequenceStepId}`)
    this.name = 'SubjectVariantStepNotFoundError'
    Object.setPrototypeOf(this, SubjectVariantStepNotFoundError.prototype)
  }
}

export class SubjectVariantNotFirstStepError extends Error {
  constructor(public readonly sequenceStepId: string) {
    super(`Subject variants apply only to the first step: ${sequenceStepId}`)
    this.name = 'SubjectVariantNotFirstStepError'
    Object.setPrototypeOf(this, SubjectVariantNotFirstStepError.prototype)
  }
}

export class SubjectVariantNotFoundError extends Error {
  constructor(public readonly variantId: string) {
    super(`Subject variant not found: ${variantId}`)
    this.name = 'SubjectVariantNotFoundError'
    Object.setPrototypeOf(this, SubjectVariantNotFoundError.prototype)
  }
}

// ─── Input types ────────────────────────────────────────────

export interface CreateSequenceInput {
  organizationId: string
  campaignId: string
  name: string
  steps: { stepNumber: number; subject: string; body: string; delayDays: number }[]
}

export interface EnrollLeadInput {
  organizationId: string
  sequenceId: string
  leadId: string
  actorClerkId: string
}
