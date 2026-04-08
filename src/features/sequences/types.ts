import type { EnrollmentStatus } from '@prisma/client'

// ─── Sequence DTOs ──────────────────────────────────────────

export interface SequenceStepDTO {
  id: string
  stepNumber: number
  subject: string
  body: string
  delayDays: number
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
