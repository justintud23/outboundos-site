// Mailbox ramp. New mailboxes send a small, slowly rising number of real
// emails per day — careful real sending IS the warmup (no fake engagement).
// Today's limit = the mailbox's preset cap for its ramp day, never above its
// dailyLimit, and never above YOUNG_DOMAIN_CAP while its domain is < 30 days old.

export type RampPresetName = 'CONSERVATIVE' | 'STANDARD' | 'AGGRESSIVE'

// Per-day caps: a step applies through `throughDay` (inclusive); after the last
// step the ramp is complete ("full" = dailyLimit).
export const RAMP_STEPS: Record<RampPresetName, { throughDay: number; cap: number }[]> = {
  CONSERVATIVE: [
    { throughDay: 3, cap: 3 }, { throughDay: 7, cap: 5 }, { throughDay: 14, cap: 10 },
    { throughDay: 21, cap: 18 }, { throughDay: 28, cap: 25 },
  ],
  STANDARD: [
    { throughDay: 3, cap: 5 }, { throughDay: 7, cap: 10 }, { throughDay: 14, cap: 18 }, { throughDay: 21, cap: 25 },
  ],
  AGGRESSIVE: [{ throughDay: 3, cap: 10 }, { throughDay: 7, cap: 18 }, { throughDay: 14, cap: 25 }],
}

export const YOUNG_DOMAIN_DAYS = 30
export const YOUNG_DOMAIN_CAP = 10
const DAY_MS = 86_400_000

export interface WarmupFields {
  dailyLimit: number
  warmupEnabled: boolean
  warmupStartedAt: Date
  rampPreset?: RampPresetName
}

export interface DomainAge {
  registeredAt: Date | null
}

function startOfDay(d: Date): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

/** 1-based ramp day; the calendar day the ramp started is day 1. */
export function warmupDay(warmupStartedAt: Date, now: Date): number {
  const days = Math.floor((startOfDay(now).getTime() - startOfDay(warmupStartedAt).getTime()) / DAY_MS)
  return Math.max(1, days + 1)
}

/** First ramp day on which the preset is at full volume. */
export function rampFullDay(preset: RampPresetName): number {
  const steps = RAMP_STEPS[preset]
  return (steps[steps.length - 1]?.throughDay ?? 0) + 1
}

/** The preset's cap for a ramp day; Infinity once the ramp is complete. */
export function presetCapForDay(preset: RampPresetName, day: number): number {
  return RAMP_STEPS[preset].find((s) => day <= s.throughDay)?.cap ?? Number.POSITIVE_INFINITY
}

/**
 * Young = registered < 30 days ago, or registration unknown. No domain row
 * (non-Graph / legacy mailboxes) → the rule doesn't apply.
 */
export function isYoungDomain(domain: DomainAge | null | undefined, now: Date): boolean {
  if (!domain) return false
  if (!domain.registeredAt) return true
  return now.getTime() - domain.registeredAt.getTime() < YOUNG_DOMAIN_DAYS * DAY_MS
}

export function effectiveDailyLimit(mailbox: WarmupFields, now: Date, domain?: DomainAge | null): number {
  const preset = mailbox.rampPreset ?? 'CONSERVATIVE'
  const rampCap = mailbox.warmupEnabled
    ? presetCapForDay(preset, warmupDay(mailbox.warmupStartedAt, now))
    : Number.POSITIVE_INFINITY
  let limit = Math.min(mailbox.dailyLimit, rampCap)
  if (isYoungDomain(domain, now)) limit = Math.min(limit, YOUNG_DOMAIN_CAP)
  return limit
}

/** True while today's limit is below the mailbox's configured dailyLimit. */
export function isWarmingUp(mailbox: WarmupFields, now: Date, domain?: DomainAge | null): boolean {
  return effectiveDailyLimit(mailbox, now, domain) < mailbox.dailyLimit
}
