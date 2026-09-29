import { prisma } from '@/lib/db/prisma'
import { getConnection } from './connection'

// Enqueues Salesforce activity-logging work for a send or a reply. Both
// functions are fire-and-forget from the caller's point of view: a send or a
// reply must never fail (or even slow down) because Salesforce is down, so
// every error here is caught and logged rather than thrown.

/** After an OutboundMessage becomes SENT: log it as a Task, but only for a lead already linked to Salesforce. */
export async function enqueueSendLog(organizationId: string, leadId: string, outboundMessageId: string): Promise<void> {
  try {
    const conn = await getConnection(organizationId)
    if (!conn || !conn.logActivity) return

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { salesforceId: true } })
    if (!lead?.salesforceId) return

    await prisma.salesforceSyncJob.createMany({
      data: [{ organizationId, leadId, type: 'LOG_SEND', outboundMessageId }],
      skipDuplicates: true,
    })
  } catch (err) {
    console.error(`[salesforce] enqueueSendLog failed for message ${outboundMessageId}:`, err)
  }
}

/** After an InboundReply is recorded: log it as a Task, or create the Lead in Salesforce first if it isn't linked yet. */
export async function enqueueReplyLog(organizationId: string, leadId: string, inboundReplyId: string): Promise<void> {
  try {
    const conn = await getConnection(organizationId)
    if (!conn || !conn.logActivity) return

    const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { salesforceId: true } })
    const type = lead?.salesforceId ? 'LOG_REPLY' : 'CREATE_LEAD'

    await prisma.salesforceSyncJob.createMany({
      data: [{ organizationId, leadId, type, inboundReplyId }],
      skipDuplicates: true,
    })
  } catch (err) {
    console.error(`[salesforce] enqueueReplyLog failed for reply ${inboundReplyId}:`, err)
  }
}
