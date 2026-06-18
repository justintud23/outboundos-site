import { prisma } from '@/lib/db/prisma'
import { evaluateBreaker, BREAKER_WINDOW_DAYS } from '../breaker'

const WINDOW_MS = BREAKER_WINDOW_DAYS * 24 * 60 * 60 * 1000

/**
 * Recompute a mailbox's recent bounce/spam rates and AUTO-PAUSE it if a
 * threshold is breached. Idempotent: a mailbox that is already auto-paused (or
 * gone) is a no-op, so re-tripping does nothing and never overwrites the
 * original pausedAt/pauseReason.
 *
 * Designed to be called best-effort from webhook ingestion — callers should
 * catch and swallow so a breaker failure never aborts event recording.
 */
export async function evaluateMailboxBreaker(mailboxId: string): Promise<void> {
  const mailbox = await prisma.mailbox.findUnique({
    where: { id: mailboxId },
    select: { id: true, autoPaused: true, breakerResetAt: true },
  })

  // Already paused or no longer exists → nothing to do (idempotent).
  if (!mailbox || mailbox.autoPaused) {
    return
  }

  const now = new Date()
  const rollingStart = new Date(now.getTime() - WINDOW_MS)
  // The window never reaches back past the last resume — a freshly-resumed
  // mailbox is judged only on sends since the reset.
  const windowStart =
    mailbox.breakerResetAt > rollingStart ? mailbox.breakerResetAt : rollingStart

  const [sends, bounces, spamReports] = await Promise.all([
    prisma.outboundMessage.count({
      where: { mailboxId, sentAt: { gte: windowStart } },
    }),
    prisma.messageEvent.count({
      where: { eventType: 'BOUNCED', createdAt: { gte: windowStart }, outboundMessage: { mailboxId } },
    }),
    prisma.messageEvent.count({
      where: { eventType: 'SPAM_REPORT', createdAt: { gte: windowStart }, outboundMessage: { mailboxId } },
    }),
  ])

  const verdict = evaluateBreaker({ sends, bounces, spamReports })
  if (!verdict.tripped) {
    return
  }

  // Conditional update: only the first trip writes pausedAt/pauseReason, so
  // concurrent bounce events can't double-pause or clobber the reason.
  await prisma.mailbox.updateMany({
    where: { id: mailboxId, autoPaused: false },
    data: { autoPaused: true, pausedAt: now, pauseReason: verdict.reason },
  })
}
