import type { Lead, ImportBatch } from '@prisma/client'

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
