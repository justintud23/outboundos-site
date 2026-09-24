import type { Mailbox, RampPreset } from '@prisma/client'
import { effectiveDailyLimit, warmupDay, isWarmingUp } from './warmup'

export interface MailboxDTO {
  id: string
  organizationId: string
  email: string
  displayName: string
  isActive: boolean
  dailyLimit: number
  sentToday: number
  // Warmup-derived, computed for "now" at fetch time:
  warmupEnabled: boolean
  effectiveDailyLimit: number // today's ramped limit (== dailyLimit when not warming)
  warmupDay: number // 1-based day in the ramp
  isWarmingUp: boolean
  rampPreset: RampPreset
  // Circuit breaker (bounce/spam auto-pause):
  autoPaused: boolean
  pausedAt: Date | null
  pauseReason: string | null
  createdAt: Date
  updatedAt: Date
}

/** Map a Mailbox row to its DTO, computing today's effective (ramped) limit. */
export function toMailboxDTO(m: Mailbox, now: Date = new Date()): MailboxDTO {
  return {
    id: m.id,
    organizationId: m.organizationId,
    email: m.email,
    displayName: m.displayName,
    isActive: m.isActive,
    dailyLimit: m.dailyLimit,
    sentToday: m.sentToday,
    warmupEnabled: m.warmupEnabled,
    effectiveDailyLimit: effectiveDailyLimit(m, now),
    warmupDay: warmupDay(m.warmupStartedAt, now),
    isWarmingUp: isWarmingUp(m, now),
    rampPreset: m.rampPreset,
    autoPaused: m.autoPaused,
    pausedAt: m.pausedAt,
    pauseReason: m.pauseReason,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  }
}

export class MailboxAlreadyExistsError extends Error {
  constructor() {
    super('A mailbox with that email address already exists.')
    this.name = 'MailboxAlreadyExistsError'
  }
}

// Orgs connected to Microsoft 365 send and monitor only Graph mailboxes, so a
// manually-typed (SendGrid) mailbox would send over Graph without its replies
// ever being monitored. Those orgs import mailboxes from Microsoft 365 instead.
export const IMPORT_FROM_MICROSOFT_MESSAGE = 'Import mailboxes from Microsoft 365 instead.'

export class ManualMailboxNotAllowedError extends Error {
  constructor() {
    super(`This organization sends through Microsoft 365. ${IMPORT_FROM_MICROSOFT_MESSAGE}`)
    this.name = 'ManualMailboxNotAllowedError'
    Object.setPrototypeOf(this, ManualMailboxNotAllowedError.prototype)
  }
}

export class MailboxNotFoundError extends Error {
  constructor() {
    super('Mailbox not found.')
    this.name = 'MailboxNotFoundError'
    Object.setPrototypeOf(this, MailboxNotFoundError.prototype)
  }
}
