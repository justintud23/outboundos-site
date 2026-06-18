import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { type MailboxDTO, toMailboxDTO, MailboxAlreadyExistsError } from '../types'

interface CreateMailboxInput {
  organizationId: string
  email: string
  displayName: string
}

export async function createMailbox({
  organizationId,
  email,
  displayName,
}: CreateMailboxInput): Promise<MailboxDTO> {
  try {
    const m = await prisma.mailbox.create({
      // warmupEnabled (true) and warmupStartedAt (now) come from schema defaults:
      // a new mailbox starts warming up from creation.
      data: { organizationId, email, displayName },
    })

    return toMailboxDTO(m)
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new MailboxAlreadyExistsError()
    }
    throw err
  }
}
