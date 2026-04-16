import type { LeadDetailDTO, TimelineItem, LeadSequenceDTO } from '../types'

export type EngagementTier = 'hot' | 'warm' | 'cold'

export interface EngagementScore {
  score: number
  tier: EngagementTier
}

export function computeEngagementScore({
  lead,
  timeline,
  sequence,
}: {
  lead: LeadDetailDTO
  timeline: TimelineItem[]
  sequence: LeadSequenceDTO | null
}): EngagementScore {
  let score = 0

  // Status signals
  if (lead.status === 'INTERESTED') score += 25
  if (lead.status === 'CONVERTED') score += 30
  if (lead.status === 'REPLIED') score += 15

  // Reply signals
  const hasPositiveReply = timeline.some(
    (i) => i.type === 'REPLY_RECEIVED' && i.metadata?.classification === 'POSITIVE',
  )
  const hasAnyReply = timeline.some((i) => i.type === 'REPLY_RECEIVED')
  if (hasPositiveReply) score += 30
  else if (hasAnyReply) score += 20

  // Outreach activity
  const hasSentEmail = timeline.some((i) => i.type === 'EMAIL_SENT')
  if (hasSentEmail) score += 10

  // Sequence enrollment
  if (sequence && sequence.status === 'ACTIVE') score += 10

  // Recency — activity in last 7 days
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const hasRecentActivity = timeline.some(
    (i) => new Date(i.timestamp).getTime() > sevenDaysAgo,
  )
  if (hasRecentActivity) score += 10

  // Staleness penalty — no activity in 14+ days
  if (timeline.length > 0) {
    const latestActivity = Math.max(
      ...timeline.map((i) => new Date(i.timestamp).getTime()),
    )
    const daysSinceActivity = (Date.now() - latestActivity) / (24 * 60 * 60 * 1000)
    if (daysSinceActivity > 14) score -= 15
  }

  // Clamp 0–100
  score = Math.max(0, Math.min(100, score))

  const tier: EngagementTier =
    score >= 60 ? 'hot' : score >= 30 ? 'warm' : 'cold'

  return { score, tier }
}
