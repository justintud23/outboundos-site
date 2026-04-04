import { prisma } from '@/lib/db/prisma'
import type { CampaignStatus, DraftStatus, ReplyClassification } from '@prisma/client'

export type { CampaignStatus, DraftStatus, ReplyClassification }

export interface CampaignDetailDraftDTO {
  id: string
  subject: string
  status: DraftStatus
  createdAt: Date
  lead: {
    id: string
    email: string
    firstName: string | null
    lastName: string | null
    company: string | null
  }
}

export interface CampaignDetailReplyDTO {
  id: string
  classification: ReplyClassification
  classificationConfidence: number | null
  rawBody: string
  receivedAt: Date
  leadEmail: string
}

export interface CampaignDetailDTO {
  id: string
  name: string
  description: string | null
  status: CampaignStatus
  createdAt: Date
  updatedAt: Date
  // Stats
  messageCount: number
  draftTotal: number
  draftPendingCount: number
  draftApprovedCount: number
  replyCount: number
  positiveReplyCount: number
  // Display lists (limited)
  drafts: CampaignDetailDraftDTO[]
  replies: CampaignDetailReplyDTO[]
}

export async function getCampaignDetail({
  organizationId,
  campaignId,
}: {
  organizationId: string
  campaignId: string
}): Promise<CampaignDetailDTO | null> {
  // Fetch campaign first — return null immediately if not found or wrong org
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, organizationId },
  })

  if (!campaign) return null

  // Fetch all related data in parallel
  const [
    drafts,
    replies,
    replyCount,
    positiveReplyCount,
    messageCount,
    draftStatusCounts,
  ] = await Promise.all([
    // Drafts for display (latest 50 — enough for any real campaign in demo)
    prisma.draft.findMany({
      where: { campaignId, organizationId },
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
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),

    // Replies via outboundMessage relation (no direct campaignId on InboundReply)
    prisma.inboundReply.findMany({
      where: { organizationId, outboundMessage: { campaignId } },
      include: { lead: { select: { email: true } } },
      orderBy: { receivedAt: 'desc' },
      take: 20,
    }),

    // Total reply count for this campaign
    prisma.inboundReply.count({
      where: { organizationId, outboundMessage: { campaignId } },
    }),

    // Positive replies only
    prisma.inboundReply.count({
      where: {
        organizationId,
        outboundMessage: { campaignId },
        classification: 'POSITIVE',
      },
    }),

    // Sent message count
    prisma.outboundMessage.count({
      where: { campaignId, organizationId },
    }),

    // Draft counts per status (single groupBy instead of 3 count queries)
    prisma.draft.groupBy({
      by: ['status'],
      where: { campaignId, organizationId },
      _count: { _all: true },
    }),
  ])

  const countByStatus = new Map(draftStatusCounts.map((r) => [r.status, r._count._all]))

  return {
    id: campaign.id,
    name: campaign.name,
    description: campaign.description,
    status: campaign.status,
    createdAt: campaign.createdAt,
    updatedAt: campaign.updatedAt,
    messageCount,
    draftTotal: draftStatusCounts.reduce((s, r) => s + r._count._all, 0),
    draftPendingCount: countByStatus.get('PENDING_REVIEW') ?? 0,
    draftApprovedCount: countByStatus.get('APPROVED') ?? 0,
    replyCount,
    positiveReplyCount,
    drafts: drafts.map((d) => ({
      id: d.id,
      subject: d.subject,
      status: d.status,
      createdAt: d.createdAt,
      lead: d.lead,
    })),
    replies: replies.map((r) => ({
      id: r.id,
      classification: r.classification,
      classificationConfidence: r.classificationConfidence,
      rawBody: r.rawBody,
      receivedAt: r.receivedAt,
      leadEmail: r.lead.email,
    })),
  }
}
