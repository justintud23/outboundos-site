import { prisma } from '@/lib/db/prisma'
import type { DraftWithLeadDTO } from '../types'

interface GetDraftsInput {
  organizationId: string
  statuses?: ('PENDING_REVIEW' | 'APPROVED' | 'REJECTED' | 'BLOCKED')[]
  limit?: number
  offset?: number
}

export async function getDrafts({
  organizationId,
  statuses = ['PENDING_REVIEW', 'APPROVED', 'BLOCKED'],
  limit = 50,
  offset = 0,
}: GetDraftsInput): Promise<{ drafts: DraftWithLeadDTO[]; total: number }> {
  const cappedLimit = Math.min(limit, 200)

  const [rows, total] = await Promise.all([
    prisma.draft.findMany({
      where: { organizationId, status: { in: statuses } },
      include: {
        lead: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            company: true,
          },
        },
        outboundMessages: { select: { id: true, status: true }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: cappedLimit,
      skip: offset,
    }),
    prisma.draft.count({ where: { organizationId, status: { in: statuses } } }),
  ])

  return {
    drafts: rows.map((d) => ({
      id: d.id,
      organizationId: d.organizationId,
      leadId: d.leadId,
      subject: d.subject,
      body: d.body,
      status: d.status,
      promptTemplateId: d.promptTemplateId,
      createdByClerkId: d.createdByClerkId,
      approvedByClerkId: d.approvedByClerkId,
      approvedAt: d.approvedAt,
      rejectedAt: d.rejectedAt,
      rejectionReason: d.rejectionReason,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      lead: d.lead,
      outboundMessage: d.outboundMessages[0] ?? null,
      guardrailFlags: Array.isArray(d.guardrailFlags) ? (d.guardrailFlags as unknown as { rule: string; match: string }[]) : null,
    })),
    total,
  }
}
