import type { CampaignStatus, ReplyClassification } from '@prisma/client'
import type { DashboardSummaryDTO } from '@/features/dashboard/server/get-dashboard-summary'
import type { ReplyWithLeadDTO } from '@/features/replies/types'

export interface AnalyticsDTO {
  sent: number
  delivered: number
  opened: number
  clicked: number
  replies: number
  positiveReplies: number
  bounced: number
  unsubscribes: number
}

// ─── Time-series ─────────────────────────────────────────────

export interface DailyActivityPoint {
  date: string
  sent: number
  replied: number
}

export interface DailyActivityExtendedPoint {
  date: string
  sent: number
  delivered: number
  opened: number
  replied: number
}

// ─── Funnel ──────────────────────────────────────────────────

export interface FunnelStageDTO {
  stage: string
  count: number
  rate: number
}

// ─── Campaign Performance ────────────────────────────────────

export interface CampaignPerformanceDTO {
  id: string
  name: string
  status: CampaignStatus
  sent: number
  delivered: number
  opened: number
  replied: number
  positiveReplies: number
  openRate: number
  replyRate: number
}

// ─── Classification ──────────────────────────────────────────

export interface ClassificationBreakdownDTO {
  classification: ReplyClassification
  count: number
}

// ─── Dashboard aggregate ─────────────────────────────────────

export interface DashboardRefreshData {
  summary: DashboardSummaryDTO
  funnel: FunnelStageDTO[]
  activity: DailyActivityPoint[]
  classification: ClassificationBreakdownDTO[]
  campaigns: CampaignPerformanceDTO[]
  recentReplies: ReplyWithLeadDTO[]
}

export interface AnalyticsRefreshData {
  analytics: AnalyticsDTO
  funnel: FunnelStageDTO[]
  activity: DailyActivityExtendedPoint[]
  campaigns: CampaignPerformanceDTO[]
  classification: ClassificationBreakdownDTO[]
}
