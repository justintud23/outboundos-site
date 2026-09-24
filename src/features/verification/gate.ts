import type { EmailCheck } from '@prisma/client'
import type { ProviderResult } from './provider'

export const VERIFY_MAX_AGE_DAYS = 90
export const MAX_VERIFY_ATTEMPTS = 3
const DAY_MS = 86_400_000

export function checkFromResult(result: ProviderResult): 'OK' | 'RISKY' | 'INVALID' {
  if (result === 'ok') return 'OK'
  if (result === 'catch_all' || result === 'unknown') return 'RISKY'
  return 'INVALID'
}

export interface GateLead {
  emailCheck: EmailCheck
  emailCheckResult: string | null
  emailCheckedAt: Date | null
}

export type GateDecision = { action: 'send' } | { action: 'wait' } | { action: 'stop'; reason: string }

/** A finished check (OK / RISKY / INVALID) no older than 90 days. */
export function isFreshResult(lead: GateLead, now: Date = new Date()): boolean {
  if (lead.emailCheck !== 'OK' && lead.emailCheck !== 'RISKY' && lead.emailCheck !== 'INVALID') return false
  if (!lead.emailCheckedAt) return false
  return now.getTime() - lead.emailCheckedAt.getTime() <= VERIFY_MAX_AGE_DAYS * DAY_MS
}

/**
 * May this lead get its FIRST email? Follow-ups are never gated.
 * `wait` means: make sure the lead is PENDING and try again later.
 */
export function verificationGate(
  lead: GateLead,
  org: { blockRiskyEmails: boolean },
  hasVerifier: boolean,
  now: Date = new Date(),
): GateDecision {
  if (!hasVerifier) return { action: 'send' }
  if (lead.emailCheck === 'INVALID') {
    return { action: 'stop', reason: `Email failed verification (${lead.emailCheckResult ?? 'invalid'})` }
  }
  if (!isFreshResult(lead, now)) return { action: 'wait' }
  if (lead.emailCheck === 'RISKY' && org.blockRiskyEmails) {
    return { action: 'stop', reason: 'Email is risky (catch-all/unknown) and risky emails are blocked' }
  }
  return { action: 'send' }
}
