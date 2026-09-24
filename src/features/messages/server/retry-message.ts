import { prisma } from '@/lib/db/prisma'
import { MessageNotFoundError, MessageNotFailedError } from '../types'

/**
 * Put a FAILED send-queue message back on the queue for another round of
 * attempts. Safe against duplicate sends: if a previous attempt already
 * created a Graph message (graphMessageId set), the queue reconciles against
 * the mailbox (Sent Items / Drafts) instead of creating a new one.
 */
export async function retryFailedMessage({
  organizationId,
  messageId,
  now = new Date(),
}: {
  organizationId: string
  messageId: string
  now?: Date
}): Promise<{ id: string; status: 'QUEUED' }> {
  const res = await prisma.outboundMessage.updateMany({
    where: { id: messageId, organizationId, status: 'FAILED' },
    data: {
      status: 'QUEUED',
      sendAttempts: 0,
      lastError: null,
      processing: false,
      processingStartedAt: null,
      scheduledFor: now,
    },
  })
  if (res.count === 1) return { id: messageId, status: 'QUEUED' }

  const existing = await prisma.outboundMessage.findFirst({
    where: { id: messageId, organizationId },
    select: { status: true },
  })
  if (!existing) throw new MessageNotFoundError()
  throw new MessageNotFailedError(existing.status)
}
