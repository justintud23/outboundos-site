import { prisma } from '@/lib/db/prisma'
import type { NextAction } from '../types'
import { ACTION_PRIORITY, ACTION_LABELS } from '../types'

interface GetNextActionsInput {
  organizationId: string
  limit?: number
}

export async function getNextActions({
  organizationId,
  limit = 50,
}: GetNextActionsInput): Promise<NextAction[]> {
  const actions: NextAction[] = []

  // Run all queries in parallel
  const [
    pendingDrafts,
    approvedDrafts,
    unreadReplies,
    newLeadsWithoutEnrollment,
    repliedLeadsWithoutFollowUp,
    interestedLeads,
  ] = await Promise.all([
    // 1. Drafts pending review
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

    // 2. Approved drafts not yet sent
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

    // 3. Unread inbound replies
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

    // 4. NEW leads with no sequence enrollment
    prisma.lead.findMany({
      where: {
        organizationId,
        status: 'NEW',
        sequenceEnrollments: { none: {} },
      },
      select: { id: true, email: true, firstName: true, lastName: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),

    // 5. REPLIED leads with no pending/approved draft
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

    // 6. INTERESTED leads (suggest marking as converted)
    prisma.lead.findMany({
      where: { organizationId, status: 'INTERESTED' },
      select: { id: true, email: true, firstName: true, lastName: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 10,
    }),
  ])

  // Build actions
  function leadName(lead: { firstName: string | null; lastName: string | null; email: string }): string {
    return [lead.firstName, lead.lastName].filter(Boolean).join(' ') || lead.email
  }

  for (const draft of pendingDrafts) {
    actions.push({
      type: 'APPROVE_DRAFT',
      priority: ACTION_PRIORITY.APPROVE_DRAFT,
      label: ACTION_LABELS.APPROVE_DRAFT,
      description: `"${draft.subject}" for ${leadName(draft.lead)}`,
      leadId: draft.lead.id,
      leadName: leadName(draft.lead),
      draftId: draft.id,
      createdAt: draft.createdAt,
    })
  }

  for (const draft of approvedDrafts) {
    actions.push({
      type: 'SEND_DRAFT',
      priority: ACTION_PRIORITY.SEND_DRAFT,
      label: ACTION_LABELS.SEND_DRAFT,
      description: `"${draft.subject}" to ${leadName(draft.lead)}`,
      leadId: draft.lead.id,
      leadName: leadName(draft.lead),
      draftId: draft.id,
      createdAt: draft.createdAt,
    })
  }

  for (const reply of unreadReplies) {
    actions.push({
      type: 'REVIEW_REPLY',
      priority: ACTION_PRIORITY.REVIEW_REPLY,
      label: ACTION_LABELS.REVIEW_REPLY,
      description: `${reply.classification} reply from ${leadName(reply.lead)}`,
      leadId: reply.lead.id,
      leadName: leadName(reply.lead),
      createdAt: reply.receivedAt,
    })
  }

  for (const lead of newLeadsWithoutEnrollment) {
    actions.push({
      type: 'ENROLL_SEQUENCE',
      priority: ACTION_PRIORITY.ENROLL_SEQUENCE,
      label: ACTION_LABELS.ENROLL_SEQUENCE,
      description: `${leadName(lead)} has no active sequence`,
      leadId: lead.id,
      leadName: leadName(lead),
      createdAt: lead.createdAt,
    })
  }

  for (const lead of repliedLeadsWithoutFollowUp) {
    actions.push({
      type: 'FOLLOW_UP',
      priority: ACTION_PRIORITY.FOLLOW_UP,
      label: ACTION_LABELS.FOLLOW_UP,
      description: `${leadName(lead)} replied but has no follow-up draft`,
      leadId: lead.id,
      leadName: leadName(lead),
      createdAt: lead.updatedAt,
    })
  }

  for (const lead of interestedLeads) {
    actions.push({
      type: 'MARK_CONVERTED',
      priority: ACTION_PRIORITY.MARK_CONVERTED,
      label: ACTION_LABELS.MARK_CONVERTED,
      description: `${leadName(lead)} is interested — ready to convert?`,
      leadId: lead.id,
      leadName: leadName(lead),
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
