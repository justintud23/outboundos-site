export type ActionType =
  | 'REVIEW_REPLY'
  | 'APPROVE_DRAFT'
  | 'SEND_DRAFT'
  | 'FOLLOW_UP'
  | 'ENROLL_SEQUENCE'
  | 'REVIEW_INTERESTED_LEAD'
  | 'MARK_CONVERTED'
  | 'NO_ACTION'

export interface NextAction {
  id: string
  type: ActionType
  priority: number
  label: string
  description?: string
  reason?: string
  leadId?: string
  leadName?: string
  draftId?: string
  replyId?: string
  sequenceId?: string
  href?: string
  previewText?: string
  createdAt: Date
}

export const ACTION_PRIORITY: Record<ActionType, number> = {
  REVIEW_REPLY: 100,
  APPROVE_DRAFT: 90,
  SEND_DRAFT: 80,
  FOLLOW_UP: 70,
  ENROLL_SEQUENCE: 60,
  REVIEW_INTERESTED_LEAD: 55,
  MARK_CONVERTED: 50,
  NO_ACTION: 0,
}

export const ACTION_LABELS: Record<ActionType, string> = {
  REVIEW_REPLY: 'Review Reply',
  APPROVE_DRAFT: 'Approve Draft',
  SEND_DRAFT: 'Send Draft',
  FOLLOW_UP: 'Follow Up',
  ENROLL_SEQUENCE: 'Enroll in Sequence',
  REVIEW_INTERESTED_LEAD: 'Review Lead',
  MARK_CONVERTED: 'Mark Converted',
  NO_ACTION: 'No Action',
}

export const ACTION_CTA: Record<ActionType, string> = {
  REVIEW_REPLY: 'Review',
  APPROVE_DRAFT: 'Approve',
  SEND_DRAFT: 'Send',
  FOLLOW_UP: 'Follow Up',
  ENROLL_SEQUENCE: 'Enroll',
  REVIEW_INTERESTED_LEAD: 'View Lead',
  MARK_CONVERTED: 'Convert',
  NO_ACTION: '',
}

export type UrgencyTier = 'high' | 'medium' | 'low'

export function getUrgencyTier(priority: number): UrgencyTier {
  if (priority >= 90) return 'high'
  if (priority >= 70) return 'medium'
  return 'low'
}

export const ACTION_HREF: Record<ActionType, string> = {
  REVIEW_REPLY: '/inbox',
  APPROVE_DRAFT: '/drafts',
  SEND_DRAFT: '/drafts',
  FOLLOW_UP: '/drafts',
  ENROLL_SEQUENCE: '/sequences',
  REVIEW_INTERESTED_LEAD: '/pipeline',
  MARK_CONVERTED: '/pipeline',
  NO_ACTION: '/dashboard',
}
