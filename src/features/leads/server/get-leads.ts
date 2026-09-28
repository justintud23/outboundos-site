import { prisma } from '@/lib/db/prisma'
import type { LeadDTO } from '../types'
import { canadaExclusionReason } from '../canada'

interface GetLeadsInput {
  organizationId: string
  limit?: number
  offset?: number
  ownerId?: string
}

export async function getLeads({
  organizationId,
  limit = 50,
  offset = 0,
  ownerId,
}: GetLeadsInput): Promise<{ leads: LeadDTO[]; total: number }> {
  const cappedLimit = Math.min(limit, 200)
  const where = {
    organizationId,
    ...(ownerId && { ownerId }),
  }

  const [rows, total, org] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: [{ score: 'desc' }, { createdAt: 'desc' }],
      take: cappedLimit,
      skip: offset,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        company: true,
        title: true,
        source: true,
        status: true,
        score: true,
        scoreReason: true,
        scoredAt: true,
        createdAt: true,
        phone: true,
        country: true,
        customFields: true,
        emailCheck: true,
        emailCheckResult: true,
        emailCheckedAt: true,
        owner: { select: { name: true, email: true } },
      },
    }),
    prisma.lead.count({ where }),
    prisma.organization.findUnique({ where: { id: organizationId }, select: { allowCanadianRecipients: true } }),
  ])

  const leads = rows.map(({ phone, country, customFields, owner, ...lead }) => ({
    ...lead,
    ownerName: owner?.name ?? owner?.email ?? null,
    canadaExclusion: org?.allowCanadianRecipients ? null : canadaExclusionReason({ email: lead.email, phone, country, customFields }),
  }))

  return { leads, total }
}
