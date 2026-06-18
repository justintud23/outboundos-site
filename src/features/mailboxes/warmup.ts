// Mailbox warmup ramp.
//
// A brand-new sending mailbox that blasts its full daily volume from day one
// looks like spam and torches its sender reputation. Warmup ramps the allowed
// daily volume up gradually over the first days, then hands off to the
// mailbox's configured dailyLimit once the ramp catches up.

// Daily send-volume cap during warmup, indexed by warmup day (day 1 = index 0).
// This array is the single source of truth for the ramp — tune it here.
// Starts low (~10/day) and eases up; effectiveDailyLimit() always takes the
// min() with the mailbox's dailyLimit, so a small dailyLimit reaches full ramp
// sooner and the ramp never pushes a mailbox above its configured limit.
export const WARMUP_RAMP_PER_DAY: readonly number[] = [
  10, // day 1
  20, // day 2
  30, // day 3
  40, // day 4
  50, // day 5
  75, // day 6
  100, // day 7
  150, // day 8
  200, // day 9
  300, // day 10
  400, // day 11
  500, // day 12
]
// After the ramp array, warmup is complete and the configured dailyLimit applies.
export const WARMUP_DAYS = WARMUP_RAMP_PER_DAY.length

export interface WarmupFields {
  dailyLimit: number
  warmupEnabled: boolean
  warmupStartedAt: Date
}

function startOfDay(d: Date): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

/**
 * 1-based warmup day. The calendar day on which warmup started is day 1.
 * Uses calendar-day boundaries so it lines up with the per-day reset.
 */
export function warmupDay(warmupStartedAt: Date, now: Date): number {
  const ms = startOfDay(now).getTime() - startOfDay(warmupStartedAt).getTime()
  const days = Math.floor(ms / 86_400_000)
  return Math.max(1, days + 1)
}

/**
 * The send limit that applies to a mailbox TODAY:
 *   min(dailyLimit, rampCapForToday)
 * If warmup is disabled, this is simply dailyLimit. The ramp cap never exceeds
 * dailyLimit (the min()), and once the warmup window has elapsed the cap is
 * effectively unbounded so dailyLimit takes over.
 */
export function effectiveDailyLimit(mailbox: WarmupFields, now: Date): number {
  if (!mailbox.warmupEnabled) {
    return mailbox.dailyLimit
  }
  const day = warmupDay(mailbox.warmupStartedAt, now)
  const rampCap =
    day <= WARMUP_DAYS
      ? (WARMUP_RAMP_PER_DAY[day - 1] ?? mailbox.dailyLimit)
      : Number.POSITIVE_INFINITY
  return Math.min(mailbox.dailyLimit, rampCap)
}

/**
 * True while the mailbox is still ramping: warmup is on AND today's effective
 * limit is below the configured dailyLimit. Useful for UI ("warming up, day N").
 */
export function isWarmingUp(mailbox: WarmupFields, now: Date): boolean {
  return mailbox.warmupEnabled && effectiveDailyLimit(mailbox, now) < mailbox.dailyLimit
}
