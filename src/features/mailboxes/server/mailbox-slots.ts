import { prisma } from '@/lib/db/prisma'

function startOfDay(d: Date): Date {
  const s = new Date(d)
  s.setHours(0, 0, 0, 0)
  return s
}

/**
 * Atomically reserve one daily-send slot on a mailbox. Returns true iff a slot
 * was claimed. Two conditional updates, each atomic at the row level (so they
 * are race-free under concurrency, exactly like the sequence-runner's claim):
 *
 *   1. Lazy reset — zero sentToday at most ONCE per day. The `lastResetAt < startOfToday`
 *      guard means the first concurrent send of a new day resets the counter and
 *      stamps lastResetAt=startOfToday; every other concurrent send then sees a
 *      non-stale lastResetAt and its reset is a no-op. No read-modify-write, so
 *      no lost reset and no double-reset.
 *   2. Conditional increment — bump sentToday ONLY while it is below
 *      `limitToday`. Because the guard lives in the WHERE clause, the database
 *      serializes the row updates: at most `limitToday` increments can ever
 *      succeed, no matter how many sends race. count === 0 means the mailbox hit
 *      today's limit. `limitToday` is the EFFECTIVE limit (warmup ramp applied),
 *      computed by the caller and passed as the literal bound — so warmup
 *      throttling is enforced with the same atomic guarantee.
 */
async function reserveMailboxSlot(
  mailboxId: string,
  limitToday: number,
  startOfToday: Date,
): Promise<boolean> {
  await prisma.mailbox.updateMany({
    where: { id: mailboxId, lastResetAt: { lt: startOfToday } },
    data: { sentToday: 0, lastResetAt: startOfToday },
  })

  // The isActive/autoPaused guards are defense-in-depth: candidates are already
  // filtered, but if a mailbox is disabled or breaker-paused in the window
  // between selection and reservation, this conditional UPDATE matches 0 rows
  // and the caller rolls to the next mailbox — a paused mailbox can NEVER be
  // reserved, atomically.
  const reservation = await prisma.mailbox.updateMany({
    where: { id: mailboxId, isActive: true, autoPaused: false, sentToday: { lt: limitToday } },
    data: { sentToday: { increment: 1 } },
  })

  return reservation.count === 1
}

/**
 * Release a previously reserved slot (atomic decrement, guarded so it can never
 * underflow below 0). Used to roll back a reservation when the send fails.
 */
async function releaseMailboxSlot(mailboxId: string): Promise<void> {
  await prisma.mailbox.updateMany({
    where: { id: mailboxId, sentToday: { gt: 0 } },
    data: { sentToday: { decrement: 1 } },
  })
}

export { startOfDay, reserveMailboxSlot, releaseMailboxSlot }
