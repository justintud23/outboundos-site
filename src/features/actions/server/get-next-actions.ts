import { prisma } from '@/lib/db/prisma'
import type { NextAction } from '../types'
import { ACTION_PRIORITY, ACTION_LABELS, ACTION_HREF } from '../types'
import { relativeTime } from '@/lib/format'

interface GetNextActionsInput {
  organizationId: string
  leadId?: string
  limit?: number
}

let actionCounter = 0
function actionId(type: string): string {
  actionCounter += 1
  return `${type}-${Date.now()}-${actionCounter}`
}

function leadName(lead: { firstName: string | null; lastName: string | null; email: string }): string {
  return [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email
}

function leadContext(lead: { firstName: string | null; lastName: string | null; email: string; company?: string | null }): string {
  const name = leadName(lead)
  return lead.company ? `${name} at ${lead.company}` : name
}

/** Time-decay aware suffix for reply/follow-up urgency */
function replyUrgencySuffix(date: Date): string {
  const hoursAgo = (Date.now() - new Date(date).getTime()) / 3_600_000
  if (hoursAgo < 1) return 'respond promptly'
  if (hoursAgo < 24) return 'follow up soon'
  return 'urgency decreasing'
}

export async function getNextActions({
  organizationId,
  leadId,
  limit = 15,
}: GetNextActionsInput): Promise<NextAction[]> {
  const actions: NextAction[] = []

  // When filtering by leadId, scope all queries to that lead
  const leadFilter = leadId ? { leadId } : {}
  const leadIdFilter = leadId ? { id: leadId } : {}

  const [
    pendingDrafts,
    approvedDrafts,
    unreadReplies,
    newLeadsWithoutEnrollment,
    repliedLeadsWithoutFollowUp,
    interestedLeads,
  ] = await Promise.all([
    prisma.draft.findMany({
      where: { organizationId, status: 'PENDING_REVIEW', ...leadFilter },
      select: {
        id: true,
        subject: true,
        createdAt: true,
        lead: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),

    prisma.draft.findMany({
      where: {
        organizationId,
        status: 'APPROVED',
        outboundMessages: { none: {} },
        ...leadFilter,
      },
      select: {
        id: true,
        subject: true,
        createdAt: true,
        approvedAt: true,
        lead: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),

    prisma.inboundReply.findMany({
      where: { organizationId, isRead: false, ...leadFilter },
      select: {
        id: true,
        receivedAt: true,
        classification: true,
        rawBody: true,
        lead: { select: { id: true, email: true, firstName: true, lastName: true, company: true } },
      },
      orderBy: { receivedAt: 'desc' },
      take: 20,
    }),

    prisma.lead.findMany({
      where: {
        organizationId,
        status: 'NEW',
        sequenceEnrollments: { none: {} },
        outboundMessages: { none: {} },
        ...leadIdFilter,
      },
      select: { id: true, email: true, firstName: true, lastName: true, company: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),

    prisma.lead.findMany({
      where: {
        organizationId,
        status: 'REPLIED',
        drafts: { none: { status: { in: ['PENDING_REVIEW', 'APPROVED'] } } },
        ...leadIdFilter,
      },
      select: { id: true, email: true, firstName: true, lastName: true, company: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 15,
    }),

    prisma.lead.findMany({
      where: { organizationId, status: 'INTERESTED', ...leadIdFilter },
      select: { id: true, email: true, firstName: true, lastName: true, company: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
  ])

  // APPROVE_DRAFT
  for (const draft of pendingDrafts) {
    actions.push({
      id: actionId('approve-draft'),
      type: 'APPROVE_DRAFT',
      priority: ACTION_PRIORITY.APPROVE_DRAFT,
      label: ACTION_LABELS.APPROVE_DRAFT,
      description: `"${draft.subject}" for ${leadContext(draft.lead)}`,
      reason: `Created ${relativeTime(draft.createdAt)} — awaiting approval`,
      leadId: draft.lead.id,
      leadName: leadName(draft.lead),
      draftId: draft.id,
      href: ACTION_HREF.APPROVE_DRAFT,
      createdAt: draft.createdAt,
    })
  }

  // SEND_DRAFT
  for (const draft of approvedDrafts) {
    const time = draft.approvedAt ? relativeTime(draft.approvedAt) : relativeTime(draft.createdAt)
    actions.push({
      id: actionId('send-draft'),
      type: 'SEND_DRAFT',
      priority: ACTION_PRIORITY.SEND_DRAFT,
      label: ACTION_LABELS.SEND_DRAFT,
      description: `"${draft.subject}" to ${leadContext(draft.lead)}`,
      reason: `Approved ${time} — ready to send`,
      leadId: draft.lead.id,
      leadName: leadName(draft.lead),
      draftId: draft.id,
      href: ACTION_HREF.SEND_DRAFT,
      createdAt: draft.createdAt,
    })
  }

  // REVIEW_REPLY — with time-decay messaging
  for (const reply of unreadReplies) {
    const classLabel = reply.classification.toLowerCase().replace(/_/g, ' ')
    const urgency = replyUrgencySuffix(reply.receivedAt)
    actions.push({
      id: actionId('review-reply'),
      type: 'REVIEW_REPLY',
      priority: ACTION_PRIORITY.REVIEW_REPLY,
      label: ACTION_LABELS.REVIEW_REPLY,
      description: `${classLabel} reply from ${leadContext(reply.lead)}`,
      reason: `Received ${relativeTime(reply.receivedAt)} — ${urgency}`,
      previewText: reply.rawBody.length > 80 ? reply.rawBody.slice(0, 80) + '…' : reply.rawBody,
      leadId: reply.lead.id,
      leadName: leadName(reply.lead),
      replyId: reply.id,
      href: ACTION_HREF.REVIEW_REPLY,
      createdAt: reply.receivedAt,
    })
  }

  // ENROLL_SEQUENCE
  for (const lead of newLeadsWithoutEnrollment) {
    actions.push({
      id: actionId('enroll-sequence'),
      type: 'ENROLL_SEQUENCE',
      priority: ACTION_PRIORITY.ENROLL_SEQUENCE,
      label: ACTION_LABELS.ENROLL_SEQUENCE,
      description: `${leadContext(lead)} — no active outreach`,
      reason: `Added ${relativeTime(lead.createdAt)} — not enrolled in any sequence`,
      leadId: lead.id,
      leadName: leadName(lead),
      href: ACTION_HREF.ENROLL_SEQUENCE,
      createdAt: lead.createdAt,
    })
  }

  // FOLLOW_UP — with time-decay messaging
  for (const lead of repliedLeadsWithoutFollowUp) {
    const urgency = replyUrgencySuffix(lead.updatedAt)
    actions.push({
      id: actionId('follow-up'),
      type: 'FOLLOW_UP',
      priority: ACTION_PRIORITY.FOLLOW_UP,
      label: ACTION_LABELS.FOLLOW_UP,
      description: `${leadContext(lead)} replied — no follow-up draft`,
      reason: `Replied ${relativeTime(lead.updatedAt)} — ${urgency}`,
      leadId: lead.id,
      leadName: leadName(lead),
      href: ACTION_HREF.FOLLOW_UP,
      createdAt: lead.updatedAt,
    })
  }

  // REVIEW_INTERESTED_LEAD + MARK_CONVERTED
  for (const lead of interestedLeads) {
    actions.push({
      id: actionId('review-interested'),
      type: 'REVIEW_INTERESTED_LEAD',
      priority: ACTION_PRIORITY.REVIEW_INTERESTED_LEAD,
      label: ACTION_LABELS.REVIEW_INTERESTED_LEAD,
      description: `${leadContext(lead)} is showing interest`,
      reason: `Interested since ${relativeTime(lead.updatedAt)} — review engagement`,
      leadId: lead.id,
      leadName: leadName(lead),
      href: ACTION_HREF.REVIEW_INTERESTED_LEAD,
      createdAt: lead.updatedAt,
    })

    actions.push({
      id: actionId('mark-converted'),
      type: 'MARK_CONVERTED',
      priority: ACTION_PRIORITY.MARK_CONVERTED,
      label: ACTION_LABELS.MARK_CONVERTED,
      description: `${leadContext(lead)} may be ready to convert`,
      reason: `Interested ${relativeTime(lead.updatedAt)} — ready to convert`,
      leadId: lead.id,
      leadName: leadName(lead),
      href: ACTION_HREF.MARK_CONVERTED,
      createdAt: lead.updatedAt,
    })
  }

  actions.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority
    return b.createdAt.getTime() - a.createdAt.getTime()
  })

  return actions.slice(0, limit)
}
