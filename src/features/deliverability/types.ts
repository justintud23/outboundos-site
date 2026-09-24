// DTOs for the Deliverability dashboard (Task 11 consumes these exact shapes).
// Built by `buildOverview` (overview.ts), loaded by `getDeliverabilityOverview`
// (server/get-overview.ts).

import type { DomainCheck } from './evaluate-domain'
import type { DomainStatusName, MailboxState } from './readiness'
import type { RampPresetName } from '@/features/mailboxes/warmup'

export interface TrendPoint {
  day: string
  sent: number
  bounces: number
  replies: number
}

export interface DomainRowDTO {
  id: string
  domain: string
  status: DomainStatusName
  checks: DomainCheck[]
  registeredAt: string | null
  registeredAtSource: string | null
  young: boolean
  lastCheckedAt: string | null
  lastError: string | null
}

export interface MailboxRowDTO {
  id: string
  email: string
  displayName: string
  domain: string
  domainStatus: DomainStatusName | null
  rampPreset: RampPresetName
  warmupEnabled: boolean
  rampDay: number
  rampFullDay: number
  todayLimit: number
  sentToday: number
  sent14: number
  bounces14: number
  replies14: number
  bounceRate: number
  replyRate: number
  state: MailboxState
  readyOn: string | null
  detail: string
  autoPaused: boolean
}

export interface DeliverabilityOverview {
  summary: {
    domains: Record<DomainStatusName, number>
    mailboxes: Record<MailboxState, number>
    capacityToday: number
    queuedNext24h: number
    sent14: number
    bounceRate14: number
    replyRate14: number
  }
  domains: DomainRowDTO[]
  mailboxes: MailboxRowDTO[]
  trend: TrendPoint[]
  trendByMailbox: Record<string, TrendPoint[]>
}
