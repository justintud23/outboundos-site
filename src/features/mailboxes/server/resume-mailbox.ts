import { prisma } from '@/lib/db/prisma'
import { type MailboxDTO, toMailboxDTO, MailboxNotFoundError } from '../types'

interface ResumeMailboxInput {
  organizationId: string
  mailboxId: string
}

/**
 * Re-activate a mailbox the circuit breaker auto-paused (org-scoped). Clears the
 * auto-pause state and bumps breakerResetAt to now() so the breaker's rolling
 * window starts fresh — the bounces that tripped it won't immediately re-trip a
 * mailbox the operator has presumably fixed (e.g. cleaned the list). There is no
 * auto-resume; this human action is the only way back.
 */
export async function resumeMailbox({
  organizationId,
  mailboxId,
}: ResumeMailboxInput): Promise<MailboxDTO> {
  const result = await prisma.mailbox.updateMany({
    where: { id: mailboxId, organizationId },
    data: {
      autoPaused: false,
      pausedAt: null,
      pauseReason: null,
      breakerResetAt: new Date(),
    },
  })

  if (result.count === 0) {
    throw new MailboxNotFoundError()
  }

  const updated = await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } })
  return toMailboxDTO(updated)
}
