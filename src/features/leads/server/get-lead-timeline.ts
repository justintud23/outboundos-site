import { prisma } from '@/lib/db/prisma'
import type { TimelineItem } from '../types'

interface GetLeadTimelineInput {
  organizationId: string
  leadId: string
}

export async function getLeadTimeline({
  organizationId,
  leadId,
}: GetLeadTimelineInput): Promise<TimelineItem[]> {
  const [outboundMessages, inboundReplies, statusChanges, enrollments] =
    await Promise.all([
      prisma.outboundMessage.findMany({
        where: { leadId, organizationId },
        select: {
          id: true,
          subject: true,
          status: true,
          sentAt: true,
          createdAt: true,
        },
        orderBy: { sentAt: 'desc' },
      }),

      prisma.inboundReply.findMany({
        where: { leadId, organizationId },
        select: {
          id: true,
          classification: true,
          receivedAt: true,
        },
        orderBy: { receivedAt: 'desc' },
      }),

      prisma.leadStatusChange.findMany({
        where: { leadId, organizationId },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          trigger: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),

      prisma.sequenceEnrollment.findMany({
        where: { leadId, organizationId },
        select: {
          id: true,
          currentStepNumber: true,
          status: true,
          startedAt: true,
          sequence: { select: { name: true } },
        },
        orderBy: { startedAt: 'desc' },
      }),
    ])

  const items: TimelineItem[] = []

  for (const msg of outboundMessages) {
    items.push({
      id: msg.id,
      type: 'EMAIL_SENT',
      description: msg.subject,
      timestamp: msg.sentAt ?? msg.createdAt,
      metadata: { status: msg.status },
    })
  }

  for (const reply of inboundReplies) {
    items.push({
      id: reply.id,
      type: 'REPLY_RECEIVED',
      description: `Reply received`,
      timestamp: reply.receivedAt,
      metadata: { classification: reply.classification },
    })
  }

  for (const sc of statusChanges) {
    items.push({
      id: sc.id,
      type: 'STATUS_CHANGE',
      description: `${sc.fromStatus} → ${sc.toStatus}`,
      timestamp: sc.createdAt,
      metadata: { fromStatus: sc.fromStatus, toStatus: sc.toStatus, trigger: sc.trigger },
    })
  }

  for (const enrollment of enrollments) {
    items.push({
      id: enrollment.id,
      type: 'SEQUENCE_STEP',
      description: `Enrolled in ${enrollment.sequence.name}`,
      timestamp: enrollment.startedAt,
      metadata: {
        sequenceName: enrollment.sequence.name,
        currentStep: enrollment.currentStepNumber,
        enrollmentStatus: enrollment.status,
      },
    })
  }

  items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return items
}
