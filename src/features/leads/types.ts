import type { Lead, ImportBatch, LeadStatus } from '@prisma/client'

// DTO returned to UI — subset of the Prisma model
export type LeadDTO = Pick<
  Lead,
  | 'id'
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'company'
  | 'title'
  | 'source'
  | 'status'
  | 'score'
  | 'scoreReason'
  | 'scoredAt'
  | 'createdAt'
>

export type ImportBatchDTO = Pick<
  ImportBatch,
  'id' | 'fileName' | 'rowCount' | 'successCount' | 'errorCount' | 'status' | 'createdAt'
>

export interface ImportBatchResult {
  batch: ImportBatchDTO
  leads: LeadDTO[]
  errors: Array<{ row: number; message: string }>
}

export interface LeadScoreResult {
  leadId: string
  score: number
  reason: string
  success: boolean
}

// ─── Pipeline ────────────────────────────────────────────────

export interface PipelineLeadDTO {
  id: string
  firstName: string | null
  lastName: string | null
  email: string
  company: string | null
  status: LeadStatus
  score: number | null
  lastActivityAt: Date
}

export interface TransitionInput {
  organizationId: string
  leadId: string
  newStatus: LeadStatus
  trigger: string
  actorClerkId?: string
  metadata?: Record<string, unknown>
}

export interface TransitionResult {
  changed: boolean
  lead: LeadDTO
  previousStatus: LeadStatus
}

// ─── Status constants ────────────────────────────────────────

export const STATUS_ORDER: Record<string, number> = {
  NEW: 0,
  CONTACTED: 1,
  REPLIED: 2,
  INTERESTED: 3,
  CONVERTED: 4,
}

export const TERMINAL_STATUSES: LeadStatus[] = ['NOT_INTERESTED', 'UNSUBSCRIBED', 'BOUNCED']

export const PIPELINE_COLUMNS: LeadStatus[] = ['NEW', 'CONTACTED', 'REPLIED', 'INTERESTED', 'CONVERTED']

export const CLASSIFICATION_TO_STATUS: Record<string, LeadStatus> = {
  POSITIVE: 'INTERESTED',
  NEGATIVE: 'NOT_INTERESTED',
  OUT_OF_OFFICE: 'REPLIED',
  UNSUBSCRIBE_REQUEST: 'UNSUBSCRIBED',
  REFERRAL: 'REPLIED',
  NEUTRAL: 'REPLIED',
  UNKNOWN: 'REPLIED',
}

// ─── Lead detail ────────────────────────────────────────────

export type LeadDetailDTO = Pick<
  Lead,
  | 'id'
  | 'email'
  | 'firstName'
  | 'lastName'
  | 'company'
  | 'title'
  | 'linkedinUrl'
  | 'phone'
  | 'source'
  | 'status'
  | 'score'
  | 'scoreReason'
  | 'scoredAt'
  | 'customFields'
  | 'createdAt'
  | 'updatedAt'
> & {
  lastActivityAt: Date
}

// ─── Timeline ───────────────────────────────────────────────

export type TimelineItemType =
  | 'EMAIL_SENT'
  | 'REPLY_RECEIVED'
  | 'STATUS_CHANGE'
  | 'SEQUENCE_STEP'

export interface TimelineItem {
  id: string
  type: TimelineItemType
  description: string
  timestamp: Date
  metadata?: Record<string, unknown>
}

// ─── Sequence enrollment ────────────────────────────────────

export interface LeadSequenceDTO {
  enrollmentId: string
  sequenceId: string
  sequenceName: string
  currentStepNumber: number
  totalSteps: number
  status: string
  nextDueAt: Date | null
  startedAt: Date
  stoppedAt: Date | null
  stoppedReason: string | null
  currentStepSubject: string | null
  nextStepSubject: string | null
}

// ─── Errors ──────────────────────────────────────────────────

export class LeadNotFoundError extends Error {
  constructor(public readonly leadId: string) {
    super(`Lead not found: ${leadId}`)
    this.name = 'LeadNotFoundError'
    Object.setPrototypeOf(this, LeadNotFoundError.prototype)
  }
}

export class LeadInTerminalStateError extends Error {
  constructor(public readonly leadId: string, public readonly status: LeadStatus) {
    super(`Lead ${leadId} is in terminal state: ${status}`)
    this.name = 'LeadInTerminalStateError'
    Object.setPrototypeOf(this, LeadInTerminalStateError.prototype)
  }
}
