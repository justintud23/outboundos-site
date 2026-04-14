import type { NextAction, ActionType } from '../types'

/** Ordered by display priority — highest-priority types first */
const SUMMARY_ORDER: ActionType[] = [
  'REVIEW_REPLY',
  'APPROVE_DRAFT',
  'SEND_DRAFT',
  'FOLLOW_UP',
  'ENROLL_SEQUENCE',
  'REVIEW_INTERESTED_LEAD',
  'MARK_CONVERTED',
]

const SUMMARY_PHRASES: Record<ActionType, (n: number) => string> = {
  REVIEW_REPLY: (n) => `${n} ${n === 1 ? 'reply needs' : 'replies need'} review`,
  APPROVE_DRAFT: (n) => `${n} ${n === 1 ? 'draft' : 'drafts'} pending approval`,
  SEND_DRAFT: (n) => `${n} ${n === 1 ? 'draft' : 'drafts'} ready to send`,
  FOLLOW_UP: (n) => `${n} follow-${n === 1 ? 'up' : 'ups'} needed`,
  ENROLL_SEQUENCE: (n) => `${n} ${n === 1 ? 'lead' : 'leads'} to enroll`,
  REVIEW_INTERESTED_LEAD: (n) => `${n} interested ${n === 1 ? 'lead' : 'leads'} to review`,
  MARK_CONVERTED: (n) => `${n} ${n === 1 ? 'lead' : 'leads'} ready to convert`,
  NO_ACTION: () => '',
}

/**
 * Generates a concise human-readable summary from an actions array.
 * Shows top 3 most important categories joined by " · ".
 * Returns "You're all caught up" when empty.
 */
export function getActionSummary(actions: NextAction[]): string {
  if (actions.length === 0) return "You're all caught up"

  const counts = new Map<ActionType, number>()
  for (const action of actions) {
    counts.set(action.type, (counts.get(action.type) ?? 0) + 1)
  }

  const parts: string[] = []
  for (const type of SUMMARY_ORDER) {
    const count = counts.get(type)
    if (count && count > 0) {
      parts.push(SUMMARY_PHRASES[type](count))
    }
    if (parts.length >= 3) break
  }

  return parts.join(' · ')
}
