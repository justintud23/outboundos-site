import { prisma } from '@/lib/db/prisma'
import type { NextAction } from '../types'
import { ACTION_PRIORITY, ACTION_LABELS, ACTION_HREF } from '../types'

interface GetNextActionsInput {
  organizationId: string
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

export async function getNextActions({
  organizationId,
  limit = 15,
}: GetNextActionsInput): Promise<NextAction[]> {
  const actions: NextAction[] = []

  const [
    pendingDrafts,
    approvedDrafts,
    unreadReplies,
    newLeadsWithoutEnrollment,
    repliedLeadsWithoutFollowUp,
    interestedLeads,
  ] = await Promise.all([
    // 1. Drafts pending review → APPROVE_DRAFT
    prisma.draft.findMany({
      where: { organizationId, status: 'PENDING_REVIEW' },
      select: {
        id: true,
        subject: true,
        createdAt: true,
        lead: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),

    // 2. Approved drafts not yet sent → SEND_DRAFT
    prisma.draft.findMany({
      where: {
        organizationId,
        status: 'APPROVED',
        outboundMessages: { none: {} },
      },
      select: {
        id: true,
        subject: true,
        createdAt: true,
        lead: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),

    // 3. Unread inbound replies → REVIEW_REPLY
    prisma.inboundReply.findMany({
      where: { organizationId, isRead: false },
      select: {
        id: true,
        receivedAt: true,
        classification: true,
        lead: { select: { id: true, email: true, firstName: true, lastName: true } },
      },
      orderBy: { receivedAt: 'desc' },
      take: 20,
    }),

    // 4. NEW leads with no sequence enrollment and no outbound → ENROLL_SEQUENCE
    prisma.lead.findMany({
      where: {
        organizationId,
        status: 'NEW',
        sequenceEnrollments: { none: {} },
        outboundMessages: { none: {} },
      },
      select: { id: true, email: true, firstName: true, lastName: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),

    // 5. REPLIED leads with no pending/approved draft → FOLLOW_UP
    prisma.lead.findMany({
      where: {
        organizationId,
        status: 'REPLIED',
        drafts: { none: { status: { in: ['PENDING_REVIEW', 'APPROVED'] } } },
      },
      select: { id: true, email: true, firstName: true, lastName: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 15,
    }),

    // 6. INTERESTED leads → REVIEW_INTERESTED_LEAD + MARK_CONVERTED
    prisma.lead.findMany({
      where: { organizationId, status: 'INTERESTED' },
      select: { id: true, email: true, firstName: true, lastName: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
  ])

  // Build APPROVE_DRAFT actions
  for (const draft of pendingDrafts) {
    actions.push({
      id: actionId('approve-draft'),
      type: 'APPROVE_DRAFT',
      priority: ACTION_PRIORITY.APPROVE_DRAFT,
      label: ACTION_LABELS.APPROVE_DRAFT,
      description: `"${draft.subject}" for ${leadName(draft.lead)}`,
      leadId: draft.lead.id,
      leadName: leadName(draft.lead),
      draftId: draft.id,
      href: ACTION_HREF.APPROVE_DRAFT,
      createdAt: draft.createdAt,
    })
  }

  // Build SEND_DRAFT actions
  for (const draft of approvedDrafts) {
    actions.push({
      id: actionId('send-draft'),
      type: 'SEND_DRAFT',
      priority: ACTION_PRIORITY.SEND_DRAFT,
      label: ACTION_LABELS.SEND_DRAFT,
      description: `"${draft.subject}" to ${leadName(draft.lead)}`,
      leadId: draft.lead.id,
      leadName: leadName(draft.lead),
      draftId: draft.id,
      href: ACTION_HREF.SEND_DRAFT,
      createdAt: draft.createdAt,
    })
  }

  // Build REVIEW_REPLY actions
  for (const reply of unreadReplies) {
    actions.push({
      id: actionId('review-reply'),
      type: 'REVIEW_REPLY',
      priority: ACTION_PRIORITY.REVIEW_REPLY,
      label: ACTION_LABELS.REVIEW_REPLY,
      description: `${reply.classification.toLowerCase()} reply from ${leadName(reply.lead)}`,
      leadId: reply.lead.id,
      leadName: leadName(reply.lead),
      replyId: reply.id,
      href: ACTION_HREF.REVIEW_REPLY,
      createdAt: reply.receivedAt,
    })
  }

  // Build ENROLL_SEQUENCE actions
  for (const lead of newLeadsWithoutEnrollment) {
    actions.push({
      id: actionId('enroll-sequence'),
      type: 'ENROLL_SEQUENCE',
      priority: ACTION_PRIORITY.ENROLL_SEQUENCE,
      label: ACTION_LABELS.ENROLL_SEQUENCE,
      description: `${leadName(lead)} has no active sequence`,
      leadId: lead.id,
      leadName: leadName(lead),
      href: ACTION_HREF.ENROLL_SEQUENCE,
      createdAt: lead.createdAt,
    })
  }

  // Build FOLLOW_UP actions
  for (const lead of repliedLeadsWithoutFollowUp) {
    actions.push({
      id: actionId('follow-up'),
      type: 'FOLLOW_UP',
      priority: ACTION_PRIORITY.FOLLOW_UP,
      label: ACTION_LABELS.FOLLOW_UP,
      description: `${leadName(lead)} replied but has no follow-up draft`,
      leadId: lead.id,
      leadName: leadName(lead),
      href: ACTION_HREF.FOLLOW_UP,
      createdAt: lead.updatedAt,
    })
  }

  // Build REVIEW_INTERESTED_LEAD + MARK_CONVERTED actions
  for (const lead of interestedLeads) {
    actions.push({
      id: actionId('review-interested'),
      type: 'REVIEW_INTERESTED_LEAD',
      priority: ACTION_PRIORITY.REVIEW_INTERESTED_LEAD,
      label: ACTION_LABELS.REVIEW_INTERESTED_LEAD,
      description: `${leadName(lead)} is showing interest — review their activity`,
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
      description: `${leadName(lead)} is interested — ready to convert?`,
      leadId: lead.id,
      leadName: leadName(lead),
      href: ACTION_HREF.MARK_CONVERTED,
      createdAt: lead.updatedAt,
    })
  }

  // Sort by priority DESC, then by createdAt DESC
  actions.sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority
    return b.createdAt.getTime() - a.createdAt.getTime()
  })

  return actions.slice(0, limit)
}
