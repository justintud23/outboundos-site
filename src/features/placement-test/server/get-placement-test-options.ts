import { prisma } from '@/lib/db/prisma'
import { mailboxOwnerFilter } from '@/features/team/server/mailbox-owner'

export interface PlacementTestOptions {
  sequences: { id: string; name: string }[]
  mailboxes: { id: string; email: string }[]
  leads: { id: string; label: string }[]
}

/**
 * Data the placement-test card needs, org-scoped. Mailboxes are only relevant
 * (and only queried) once the org has a Microsoft 365 tenant — auto-send goes
 * through Graph, and so does a placement test. The list is further scoped to
 * the campaign's own sending set (mailboxOwnerFilter for the campaign owner),
 * matching the rule sendPlacementTest enforces on the chosen mailbox.
 */
export async function getPlacementTestOptions({
  organizationId,
  campaignId,
  campaignOwnerId,
  hasMsTenant,
}: {
  organizationId: string
  campaignId: string
  campaignOwnerId: string | null
  hasMsTenant: boolean
}): Promise<PlacementTestOptions> {
  const ownerFilter = hasMsTenant ? await mailboxOwnerFilter(organizationId, campaignOwnerId) : null
  const [sequences, mailboxes, enrollments] = await Promise.all([
    prisma.sequence.findMany({
      where: { organizationId, campaignId },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
    ownerFilter
      ? prisma.mailbox.findMany({
          where: { organizationId, provider: 'MICROSOFT_GRAPH', isActive: true, autoPaused: false, ...ownerFilter },
          select: { id: true, email: true },
          orderBy: { email: 'asc' },
        })
      : Promise.resolve([]),
    prisma.sequenceEnrollment.findMany({
      where: { organizationId, sequence: { campaignId } },
      take: 50,
      select: { lead: { select: { id: true, firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const seen = new Set<string>()
  const leads: { id: string; label: string }[] = []
  for (const { lead } of enrollments) {
    if (seen.has(lead.id)) continue
    seen.add(lead.id)
    const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ')
    leads.push({ id: lead.id, label: name || lead.email })
  }

  return { sequences, mailboxes, leads }
}
