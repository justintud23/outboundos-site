import { prisma } from '@/lib/db/prisma'
import type { ReplyClassification } from '@prisma/client'
import type { ReplyWithLeadDTO } from '../types'

interface GetRepliesInput {
  organizationId: string
  classification?: ReplyClassification
  limit?: number
  offset?: number
}

export async function getReplies({
  organizationId,
  classification,
  limit = 50,
  offset = 0,
}: GetRepliesInput): Promise<{ replies: ReplyWithLeadDTO[]; total: number }> {
  const cappedLimit = Math.min(limit, 200)
  const where = {
    organizationId,
    ...(classification !== undefined && { classification }),
  }

  const [rows, total] = await Promise.all([
    prisma.inboundReply.findMany({
      where,
      include: { lead: { select: { email: true } } },
      orderBy: { receivedAt: 'desc' },
      take: cappedLimit,
      skip: offset,
    }),
    prisma.inboundReply.count({ where }),
  ])

  return {
    replies: rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      leadId: r.leadId,
      outboundMessageId: r.outboundMessageId,
      rawBody: r.rawBody,
      classification: r.classification,
      classificationConfidence: r.classificationConfidence,
      receivedAt: r.receivedAt,
      createdAt: r.createdAt,
      leadEmail: r.lead.email,
    })),
    total,
  }
}
