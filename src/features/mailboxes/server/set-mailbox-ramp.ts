import type { RampPreset } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { type MailboxDTO, toMailboxDTO, MailboxNotFoundError } from '../types'

async function updateScoped(organizationId: string, mailboxId: string, data: object): Promise<MailboxDTO> {
  const result = await prisma.mailbox.updateMany({ where: { id: mailboxId, organizationId }, data })
  if (result.count === 0) throw new MailboxNotFoundError()
  return toMailboxDTO(await prisma.mailbox.findUniqueOrThrow({ where: { id: mailboxId } }))
}

/** Change the ramp schedule. The ramp day is kept — only the table changes. */
export function setMailboxRampPreset(input: { organizationId: string; mailboxId: string; rampPreset: RampPreset }) {
  return updateScoped(input.organizationId, input.mailboxId, { rampPreset: input.rampPreset })
}

/** Start the ramp over from day 1 (e.g. after a long pause). */
export function restartMailboxRamp(input: { organizationId: string; mailboxId: string }) {
  return updateScoped(input.organizationId, input.mailboxId, { warmupStartedAt: new Date(), warmupEnabled: true })
}
