import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import type { MailboxDTO } from '../types'
import { MailboxAlreadyExistsError } from '../types'

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
      data: { organizationId, email, displayName },
    })

    return {
      id: m.id,
      organizationId: m.organizationId,
      email: m.email,
      displayName: m.displayName,
      isActive: m.isActive,
      dailyLimit: m.dailyLimit,
      sentToday: m.sentToday,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
    }
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
