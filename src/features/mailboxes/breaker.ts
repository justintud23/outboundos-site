// Bounce/spam circuit breaker for sending mailboxes.
//
// A mailbox with a high bounce or spam-complaint rate is torching the domain's
// sender reputation with every send. The breaker watches recent rates and, past
// a minimum-volume floor, auto-pauses the mailbox so it stops sending until a
// human intervenes. Tunable knobs all live here.

// Rolling window over which rates are measured.
export const BREAKER_WINDOW_DAYS = 7

// Minimum sends (in the window) before the breaker can trip at all. Below this,
// the sample is too small to be meaningful — a single bounce on a brand-new
// mailbox must not pause it. So even a 100% bounce rate on < this many sends
// never trips.
export const BREAKER_MIN_VOLUME = 20

// Hard-bounce rate danger threshold. Industry guidance treats ~2–3% as
// "concerning" and ~5%+ as block-risk. Because auto-pausing is disruptive, we
// trip at the upper, unambiguous end (5%) to avoid pausing on normal variance.
export const BOUNCE_RATE_THRESHOLD = 0.05

// Spam-complaint rate danger threshold. Gmail/Yahoo bulk-sender rules cap
// complaints at 0.3% (hard) and target < 0.1%. Complaints are a far more severe
// reputation signal than bounces, so we trip at the stricter 0.1%. Combined with
// the volume floor this means roughly one complaint per ~1000+ recent sends.
export const SPAM_RATE_THRESHOLD = 0.001

export interface BreakerStats {
  sends: number // denominator: messages this mailbox SENT within the window
  bounces: number // BOUNCED events within the window
  spamReports: number // SPAM_REPORT events within the window
}

export interface BreakerVerdict {
  tripped: boolean
  reason: string | null // human-readable, e.g. "bounce rate 6.2% exceeded 5.0%"
}

function formatPct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

/**
 * Pure evaluation: given recent counts, decide whether the mailbox should be
 * paused. Spam is checked before bounce (it's the more severe signal). Returns
 * the first threshold breached, with a reason string suitable for the UI.
 */
export function evaluateBreaker(stats: BreakerStats): BreakerVerdict {
  // Minimum-volume floor: never trip on a tiny sample, even at 100% bounce rate.
  if (stats.sends < BREAKER_MIN_VOLUME) {
    return { tripped: false, reason: null }
  }

  const spamRate = stats.spamReports / stats.sends
  if (spamRate >= SPAM_RATE_THRESHOLD) {
    return {
      tripped: true,
      reason: `spam-complaint rate ${formatPct(spamRate)} exceeded ${formatPct(SPAM_RATE_THRESHOLD)}`,
    }
  }

  const bounceRate = stats.bounces / stats.sends
  if (bounceRate >= BOUNCE_RATE_THRESHOLD) {
    return {
      tripped: true,
      reason: `bounce rate ${formatPct(bounceRate)} exceeded ${formatPct(BOUNCE_RATE_THRESHOLD)}`,
    }
  }

  return { tripped: false, reason: null }
}
