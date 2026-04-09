import type { LeadStatus, ReplyClassification, MessageStatus } from '@prisma/client'

// ─── Thread list ────────────────────────────────────────────

export interface InboxThreadDTO {
  leadId: string
  leadName: string
  leadEmail: string
  leadCompany: string | null
  leadStatus: LeadStatus
  lastActivityAt: Date
  unreadCount: number
  messageCount: number
  replyCount: number
  latestClassification: ReplyClassification | null
  latestPreview: string
}

export type InboxFilter = 'all' | 'unread' | 'interested' | 'unsubscribed' | 'recent'

// ─── Thread detail ──────────────────────────────────────────

export interface ThreadDetailDTO {
  lead: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    company: string | null
    title: string | null
    status: LeadStatus
    score: number | null
  }
  messages: ThreadMessageDTO[]
  totalMessages: number
}

export interface ThreadMessageDTO {
  id: string
  direction: 'outbound' | 'inbound'
  subject: string | null
  body: string
  timestamp: Date
  classification?: ReplyClassification
  classificationConfidence?: number
  status?: MessageStatus
  isRead?: boolean
}
