export type ActionType =
  | 'APPROVE_DRAFT'
  | 'SEND_DRAFT'
  | 'REVIEW_REPLY'
  | 'ENROLL_SEQUENCE'
  | 'FOLLOW_UP'
  | 'MARK_CONVERTED'
  | 'NO_ACTION'

export interface NextAction {
  type: ActionType
  priority: number
  label: string
  description?: string
  leadId?: string
  leadName?: string
  draftId?: string
  sequenceEnrollmentId?: string
  createdAt: Date
}

export const ACTION_PRIORITY: Record<ActionType, number> = {
  REVIEW_REPLY: 100,
  APPROVE_DRAFT: 90,
  SEND_DRAFT: 80,
  FOLLOW_UP: 70,
  ENROLL_SEQUENCE: 60,
  MARK_CONVERTED: 50,
  NO_ACTION: 0,
}

export const ACTION_LABELS: Record<ActionType, string> = {
  REVIEW_REPLY: 'Review Reply',
  APPROVE_DRAFT: 'Approve Draft',
  SEND_DRAFT: 'Send Draft',
  FOLLOW_UP: 'Follow Up',
  ENROLL_SEQUENCE: 'Enroll in Sequence',
  MARK_CONVERTED: 'Mark Converted',
  NO_ACTION: 'No Action',
}

export const ACTION_CTA: Record<ActionType, string> = {
  REVIEW_REPLY: 'Review',
  APPROVE_DRAFT: 'Approve',
  SEND_DRAFT: 'Send',
  FOLLOW_UP: 'Follow Up',
  ENROLL_SEQUENCE: 'Enroll',
  MARK_CONVERTED: 'Convert',
  NO_ACTION: '',
}

export const ACTION_HREF: Record<ActionType, string> = {
  REVIEW_REPLY: '/inbox',
  APPROVE_DRAFT: '/drafts',
  SEND_DRAFT: '/drafts',
  FOLLOW_UP: '/leads',
  ENROLL_SEQUENCE: '/sequences',
  MARK_CONVERTED: '/pipeline',
  NO_ACTION: '/dashboard',
}
