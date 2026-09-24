import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'

// Accepts either the root client or a transaction client so this can run
// inside enrollLead's enrollment transaction as well as standalone from the
// sequence runner.
type Db = typeof prisma | Prisma.TransactionClient

/**
 * Put a lead in the verification queue. Idempotent: leaves an already-PENDING
 * lead alone (a worker may be mid-check for it — don't reset its attempt
 * count out from under it).
 */
export async function queueLeadForVerification(client: Db, leadId: string): Promise<void> {
  await client.lead.updateMany({
    where: { id: leadId, emailCheck: { not: 'PENDING' } },
    data: { emailCheck: 'PENDING', emailCheckAttempts: 0 },
  })
}
