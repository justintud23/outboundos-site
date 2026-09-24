import { prisma } from '@/lib/db/prisma'
import { getDomainHealthMap, domainOf } from '@/features/deliverability/server/domain-health'
import { isDomainUsable } from '@/features/deliverability/readiness'

/**
 * Sticky, least-loaded mailbox assignment: a lead hears from ONE mailbox for
 * the whole sequence so follow-ups thread and replies land in one inbox.
 * The conditional update (mailboxId: null) makes concurrent assignment safe.
 */
export async function assignEnrollmentMailbox(organizationId: string, enrollmentId: string): Promise<string | null> {
  // A Microsoft 365 org only sends from (and only monitors) Graph mailboxes.
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { msTenantId: true } })
  const mailboxes = await prisma.mailbox.findMany({
    where: {
      organizationId,
      isActive: true,
      autoPaused: false,
      ...(org?.msTenantId && { provider: 'MICROSOFT_GRAPH' as const }),
    },
    select: { id: true, email: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
  })
  if (mailboxes.length === 0) return null

  // Microsoft 365 orgs only send from Graph mailboxes: never assign one whose
  // domain fails its DNS checks (or was never checked) — it would land in
  // spam or lose replies.
  let usable = mailboxes
  if (org?.msTenantId) {
    const domainHealth = await getDomainHealthMap(organizationId)
    usable = mailboxes.filter((m) => isDomainUsable(domainHealth.get(domainOf(m.email))?.status))
  }
  if (usable.length === 0) return null

  usable.sort((a, b) => a._count.enrollments - b._count.enrollments || (a.id < b.id ? -1 : 1))
  const first = usable[0]
  if (!first) return null
  const chosen = first.id

  const res = await prisma.sequenceEnrollment.updateMany({
    where: { id: enrollmentId, mailboxId: null },
    data: { mailboxId: chosen },
  })
  if (res.count === 1) return chosen

  const existing = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollmentId }, select: { mailboxId: true } })
  return existing?.mailboxId ?? null
}
