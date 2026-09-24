// Business-hours window and per-mailbox pacing. Pure: all time math goes
// through Intl so the org's IANA timezone (incl. DST) is honored without a
// date library.

export interface SendWindowConfig {
  timezone: string
  businessHoursStart: number // hour, 0–23, inclusive
  businessHoursEnd: number // hour, 1–24, exclusive
  sendDays: number[] // 0=Sun … 6=Sat
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function zonedParts(
  date: Date,
  timezone: string,
): { weekday: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return {
    weekday: WEEKDAYS[get('weekday')] ?? -1,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  }
}

export function isInSendWindow(now: Date, cfg: SendWindowConfig): boolean {
  const { weekday, hour, minute } = zonedParts(now, cfg.timezone)
  if (!cfg.sendDays.includes(weekday)) return false
  const minutes = hour * 60 + minute
  return minutes >= cfg.businessHoursStart * 60 && minutes < cfg.businessHoursEnd * 60
}

/** Even spacing that spreads `dailyLimit` sends across the business window. */
export function mailboxSpacingMs(cfg: SendWindowConfig, dailyLimit: number): number {
  const windowMs = (cfg.businessHoursEnd - cfg.businessHoursStart) * 60 * 60 * 1000
  return Math.floor(windowMs / Math.max(1, dailyLimit))
}

/** now + spacing × U(0.7, 1.3): ±30% jitter so sends don't land on a grid. */
export function nextSendAt(now: Date, spacingMs: number, random: () => number = Math.random): Date {
  const factor = 0.7 + 0.6 * random()
  return new Date(now.getTime() + Math.round(spacingMs * factor))
}
