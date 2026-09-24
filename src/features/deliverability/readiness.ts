import { isYoungDomain, rampFullDay, warmupDay, YOUNG_DOMAIN_DAYS, type RampPresetName } from '@/features/mailboxes/warmup'

export type MailboxState = 'READY' | 'RAMPING' | 'PAUSED' | 'BLOCKED' | 'NEEDS_ATTENTION'
export type DomainStatusName = 'UNVERIFIED' | 'HEALTHY' | 'WARNING' | 'FAILING'

export const BOUNCE_RATE_LIMIT = 0.02
export const MIN_SENDS_FOR_BOUNCE_RATE = 20
const DAY_MS = 86_400_000

export function isDomainUsable(status: DomainStatusName | null | undefined): boolean {
  return status === 'HEALTHY' || status === 'WARNING'
}

export interface ReadinessInput {
  mailbox: {
    dailyLimit: number
    warmupEnabled: boolean
    warmupStartedAt: Date
    rampPreset: RampPresetName
    isActive: boolean
    autoPaused: boolean
    pauseReason: string | null
  }
  domain: { status: DomainStatusName; registeredAt: Date | null } | null
  sent14: number
  bounces14: number
  now: Date
}

/** Advisory status for the dashboard. Never used to block sending. */
export function mailboxReadiness(i: ReadinessInput): { state: MailboxState; readyOn: Date | null; detail: string } {
  const { mailbox, domain, now } = i

  if (!mailbox.isActive) return { state: 'PAUSED', readyOn: null, detail: 'Turned off' }
  if (mailbox.autoPaused) return { state: 'PAUSED', readyOn: null, detail: mailbox.pauseReason ?? 'Paused automatically' }

  if (!domain || !isDomainUsable(domain.status)) {
    const detail = !domain || domain.status === 'UNVERIFIED'
      ? 'Domain not verified yet — click Check now'
      : 'Domain is failing its DNS checks'
    return { state: 'BLOCKED', readyOn: null, detail }
  }

  if (i.sent14 >= MIN_SENDS_FOR_BOUNCE_RATE && i.bounces14 / i.sent14 >= BOUNCE_RATE_LIMIT) {
    return { state: 'NEEDS_ATTENTION', readyOn: null, detail: `Bounce rate ${((i.bounces14 / i.sent14) * 100).toFixed(1)}% over 14 days` }
  }

  const day = warmupDay(mailbox.warmupStartedAt, now)
  const fullDay = rampFullDay(mailbox.rampPreset)
  const rampDone = !mailbox.warmupEnabled || day >= fullDay
  const young = isYoungDomain(domain, now)
  if (rampDone && !young) return { state: 'READY', readyOn: null, detail: 'Ready for full volume' }

  if (young && !domain.registeredAt) {
    return { state: 'RAMPING', readyOn: null, detail: 'Domain age unknown — set its registration date' }
  }
  const rampReady = rampDone ? now : new Date(now.getTime() + (fullDay - day) * DAY_MS)
  const domainReady = domain.registeredAt ? new Date(domain.registeredAt.getTime() + YOUNG_DOMAIN_DAYS * DAY_MS) : now
  const readyOn = rampReady > domainReady ? rampReady : domainReady
  return { state: 'RAMPING', readyOn, detail: rampDone ? 'New domain (under 30 days)' : `Ramp day ${day} of ${fullDay - 1}` }
}
