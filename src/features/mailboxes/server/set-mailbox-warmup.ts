import { prisma } from '@/lib/db/prisma'
import { type MailboxDTO, toMailboxDTO, MailboxNotFoundError } from '../types'

interface SetMailboxWarmupInput {
  organizationId: string
  mailboxId: string
  warmupEnabled: boolean
}

/**
 * Toggle a mailbox's warmup on/off (org-scoped). Note: re-enabling does NOT
 * reset warmupStartedAt — the ramp resumes from the original start date, so a
 * long-lived mailbox that re-enables warmup is likely already past the ramp.
 */
export async function setMailboxWarmup({
  organizationId,
  mailboxId,
  warmupEnabled,
}: SetMailboxWarmupInput): Promise<MailboxDTO> {
  // Org-scoped guard in the WHERE: a mailbox from another org updates 0 rows.
  const result = await prisma.mailbox.updateMany({
    where: { id: mailboxId, organizationId },
    data: { warmupEnabled },
  })

  if (result.count === 0) {
    throw new MailboxNotFoundError()
  }

  const updated = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } })
  return toMailboxDTO(updated)
}
