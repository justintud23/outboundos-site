// Pure 14-day aggregation for the Deliverability dashboard. Buckets by the
// org's timezone (Review Focus #5) — not UTC — so "today" and each trend day
// line up with what a human in that timezone would call "today".

import { effectiveDailyLimit, isYoungDomain, rampFullDay, warmupDay, type RampPresetName } from '@/features/mailboxes/warmup'
import { isDomainUsable, mailboxReadiness, type DomainStatusName, type MailboxState } from './readiness'
import type { DomainCheck } from './evaluate-domain'
import type { DeliverabilityOverview, DomainRowDTO, MailboxRowDTO, TrendPoint } from './types'

const DAY_MS = 86_400_000

export interface OverviewInput {
  now: Date
  timezone: string
  mailboxes: {
    id: string; email: string; displayName: string; dailyLimit: number; sentToday: number; lastResetAt: Date
    warmupEnabled: boolean; warmupStartedAt: Date; rampPreset: RampPresetName; isActive: boolean
    autoPaused: boolean; pauseReason: string | null
  }[]
  domains: {
    id: string; domain: string; status: DomainStatusName; checks: unknown; registeredAt: Date | null
    registeredAtSource: string | null; lastCheckedAt: Date | null; lastError: string | null
  }[]
  sends: { mailboxId: string; sentAt: Date }[]
  bounces: { mailboxId: string; at: Date }[]
  replies: { mailboxId: string; at: Date }[]
  queuedNext24h: number
}

export function dayKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function lastNDays(now: Date, timezone: string, n = 14): string[] {
  return Array.from({ length: n }, (_, i) => dayKey(new Date(now.getTime() - (n - 1 - i) * DAY_MS), timezone))
}

const rate = (num: number, den: number) => (den > 0 ? num / den : 0)
const domainOfEmail = (email: string) => (email.split('@')[1] ?? '').toLowerCase()
const startOfDay = (d: Date) => { const s = new Date(d); s.setHours(0, 0, 0, 0); return s }

export function buildOverview(i: OverviewInput): DeliverabilityOverview {
  const days = lastNDays(i.now, i.timezone)
  const daySet = new Set(days)
  const domainByName = new Map(i.domains.map((dm) => [dm.domain, dm]))

  const emptyTrend = () => days.map((day) => ({ day, sent: 0, bounces: 0, replies: 0 }))
  const trend: TrendPoint[] = emptyTrend()
  const trendByMailbox: Record<string, TrendPoint[]> = Object.fromEntries(i.mailboxes.map((m) => [m.id, emptyTrend()]))
  const bump = (mailboxId: string, at: Date, field: 'sent' | 'bounces' | 'replies') => {
    const key = dayKey(at, i.timezone)
    if (!daySet.has(key)) return
    const idx = days.indexOf(key)
    trend[idx]![field]++
    const mb = trendByMailbox[mailboxId]
    if (mb) mb[idx]![field]++
  }
  i.sends.forEach((s) => bump(s.mailboxId, s.sentAt, 'sent'))
  i.bounces.forEach((b) => bump(b.mailboxId, b.at, 'bounces'))
  i.replies.forEach((r) => bump(r.mailboxId, r.at, 'replies'))

  const sum = (pts: TrendPoint[] | undefined, f: 'sent' | 'bounces' | 'replies') => (pts ?? []).reduce((a, p) => a + p[f], 0)

  const mailboxes: MailboxRowDTO[] = i.mailboxes.map((m) => {
    const domain = domainOfEmail(m.email)
    const dh = domainByName.get(domain) ?? null
    const sent14 = sum(trendByMailbox[m.id], 'sent')
    const bounces14 = sum(trendByMailbox[m.id], 'bounces')
    const replies14 = sum(trendByMailbox[m.id], 'replies')
    const readiness = mailboxReadiness({
      mailbox: m,
      domain: dh ? { status: dh.status, registeredAt: dh.registeredAt } : null,
      sent14, bounces14, now: i.now,
    })
    return {
      id: m.id, email: m.email, displayName: m.displayName, domain,
      domainStatus: dh?.status ?? null,
      rampPreset: m.rampPreset, warmupEnabled: m.warmupEnabled,
      rampDay: warmupDay(m.warmupStartedAt, i.now), rampFullDay: rampFullDay(m.rampPreset),
      todayLimit: effectiveDailyLimit(m, i.now, dh ? { registeredAt: dh.registeredAt } : null),
      sentToday: m.lastResetAt < startOfDay(i.now) ? 0 : m.sentToday,
      sent14, bounces14, replies14,
      bounceRate: rate(bounces14, sent14), replyRate: rate(replies14, sent14),
      state: readiness.state, readyOn: readiness.readyOn?.toISOString() ?? null, detail: readiness.detail,
      autoPaused: m.autoPaused,
    }
  })

  const domains: DomainRowDTO[] = i.domains.map((dm) => ({
    id: dm.id, domain: dm.domain, status: dm.status,
    checks: Array.isArray(dm.checks) ? (dm.checks as DomainCheck[]) : [],
    registeredAt: dm.registeredAt?.toISOString() ?? null, registeredAtSource: dm.registeredAtSource,
    young: isYoungDomain({ registeredAt: dm.registeredAt }, i.now),
    lastCheckedAt: dm.lastCheckedAt?.toISOString() ?? null, lastError: dm.lastError,
  }))

  const count = <K extends string>(keys: readonly K[], values: K[]) =>
    Object.fromEntries(keys.map((k) => [k, values.filter((v) => v === k).length])) as Record<K, number>
  const sent14 = sum(trend, 'sent')

  return {
    summary: {
      domains: count(['UNVERIFIED', 'HEALTHY', 'WARNING', 'FAILING'] as const, domains.map((dm) => dm.status)),
      mailboxes: count(['READY', 'RAMPING', 'PAUSED', 'BLOCKED', 'NEEDS_ATTENTION'] as const, mailboxes.map((m) => m.state as MailboxState)),
      capacityToday: mailboxes
        .filter((m) => m.state !== 'PAUSED' && isDomainUsable(m.domainStatus))
        .reduce((a, m) => a + (Number.isFinite(m.todayLimit) ? m.todayLimit : 0), 0),
      queuedNext24h: i.queuedNext24h,
      sent14,
      bounceRate14: rate(sum(trend, 'bounces'), sent14),
      replyRate14: rate(sum(trend, 'replies'), sent14),
    },
    domains, mailboxes, trend, trendByMailbox,
  }
}
