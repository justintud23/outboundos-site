import { prisma } from '@/lib/db/prisma'

/**
 * Sticky, least-loaded mailbox assignment: a lead hears from ONE mailbox for
 * the whole sequence so follow-ups thread and replies land in one inbox.
 * The conditional update (mailboxId: null) makes concurrent assignment safe.
 */
export async function assignEnrollmentMailbox(organizationId: string, enrollmentId: string): Promise<string | null> {
  const mailboxes = await prisma.mailbox.findMany({
    where: { organizationId, isActive: true, autoPaused: false },
    select: { id: true, _count: { select: { enrollments: { where: { status: 'ACTIVE' } } } } },
  })
  if (mailboxes.length === 0) return null

  mailboxes.sort((a, b) => a._count.enrollments - b._count.enrollments || (a.id < b.id ? -1 : 1))
  const first = mailboxes[0]
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
