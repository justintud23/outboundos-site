import { Prisma, type SalesforceJobType, type SalesforceJobStatus } from '@prisma/client'
import { prisma } from '@/lib/db/prisma'
import { releaseExpiredRateLimits } from './connection'
import { getSalesforceClient, type SfClient } from './client'
import { resolveSfUserId } from './owner-match'
import { fetchPeople } from './records'
import { SalesforceApiError, SalesforceAuthError, SalesforceRateLimitError } from './errors'

export const BACKOFF_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000, 12 * 3_600_000]
export const MAX_ATTEMPTS = 6

// Errors from creating a Task that mean the linked Salesforce record is gone
// (deleted, or the id no longer resolves) — the lead's link is stale and
// must be cleared rather than retried against a dead id.
const DELETED_REF_CODES = new Set(['ENTITY_IS_DELETED', 'INVALID_CROSS_REFERENCE_KEY', 'NOT_FOUND'])

const LOG_JOB_TYPES: SalesforceJobType[] = ['LOG_SEND', 'LOG_REPLY']
const DONE_OR_FAILED: SalesforceJobStatus[] = ['DONE', 'FAILED']

export interface ProcessJobsResult {
  done: number
  failed: number
  retried: number
  skippedOrgs: number
}

const JOB_INCLUDE = {
  outboundMessage: { select: { subject: true, body: true, sentAt: true } },
  inboundReply: { select: { subject: true, rawBody: true, receivedAt: true, createdAt: true } },
  lead: {
    select: {
      id: true,
      organizationId: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      title: true,
      phone: true,
      ownerId: true,
      salesforceId: true,
      salesforceType: true,
    },
  },
} satisfies Prisma.SalesforceSyncJobInclude

type JobRow = Prisma.SalesforceSyncJobGetPayload<{ include: typeof JOB_INCLUDE }>
type Outcome = 'done' | 'failed' | 'retried'

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

/**
 * Runs due Salesforce sync jobs: logging sends/replies as Tasks, and
 * creating+linking a Salesforce Lead for a reply from an unlinked lead.
 * Jobs are grouped by org so one Salesforce client (and one auth/rate-limit
 * outcome) covers a whole org's batch. Never throws — every per-job error is
 * caught and turned into a retry, a failure, or a skipped org.
 *
 * `clock` defaults to `Date.now` and exists only so tests can control the
 * budget deterministically without depending on how many times the budget
 * check itself calls it.
 */
export async function processSalesforceJobs(
  opts: { limit?: number; now?: Date; budgetMs?: number; clock?: () => number } = {},
): Promise<ProcessJobsResult> {
  const now = opts.now ?? new Date()
  const limit = opts.limit ?? 50
  const budgetMs = opts.budgetMs ?? 8_000
  const clock = opts.clock ?? Date.now
  const startedAt = clock()

  await releaseExpiredRateLimits(now)

  const jobs = await prisma.salesforceSyncJob.findMany({
    where: {
      status: 'PENDING',
      nextAttemptAt: { lte: now },
      organization: { salesforceConnection: { is: { status: 'CONNECTED' } } },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    include: JOB_INCLUDE,
  })

  const result: ProcessJobsResult = { done: 0, failed: 0, retried: 0, skippedOrgs: 0 }

  const byOrg = new Map<string, JobRow[]>()
  for (const job of jobs) {
    const arr = byOrg.get(job.organizationId)
    if (arr) arr.push(job)
    else byOrg.set(job.organizationId, [job])
  }

  for (const [orgId, orgJobs] of byOrg) {
    if (clock() - startedAt > budgetMs) return result

    const client = getSalesforceClient(orgId)
    for (const job of orgJobs) {
      if (clock() - startedAt > budgetMs) return result

      try {
        const outcome = job.type === 'CREATE_LEAD' ? await processCreateLead(client, job, now) : await processLogTask(client, job, now)
        result[outcome]++
      } catch (err) {
        if (err instanceof SalesforceAuthError || err instanceof SalesforceRateLimitError) {
          result.skippedOrgs++
          break // leave the rest of this org's jobs PENDING, untouched
        }
        const outcome = await recordGenericFailure(job, err, now)
        result[outcome]++
      }
    }
  }

  return result
}

/** LOG_SEND / LOG_REPLY: logs the send or reply as a Salesforce Task on the linked record. */
async function processLogTask(client: SfClient, job: JobRow, now: Date): Promise<Outcome> {
  // Re-read the link rather than trusting the batch read: an earlier job in
  // this same run (a CREATE_LEAD for the same lead) may have just linked it.
  const lead = await prisma.lead.findUnique({ where: { id: job.leadId }, select: { salesforceId: true, ownerId: true } })
  if (!lead?.salesforceId) {
    await prisma.salesforceSyncJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', lastError: 'Lead is not linked to Salesforce' },
    })
    return 'failed'
  }

  const isSend = job.type === 'LOG_SEND'
  const subjectText = job.outboundMessage?.subject ?? job.inboundReply?.subject ?? null
  const bodyText = job.outboundMessage?.body ?? job.inboundReply?.rawBody ?? ''
  const activityDate = job.outboundMessage?.sentAt ?? job.inboundReply?.receivedAt ?? job.inboundReply?.createdAt ?? now
  const ownerId = await resolveSfUserId(client, job.organizationId, lead.ownerId)

  const fields: Record<string, unknown> = {
    WhoId: lead.salesforceId,
    Subject: truncate(`${isSend ? 'Email' : 'Reply'}: ${subjectText ?? '(no subject)'}`, 255),
    Description: truncate(bodyText, 32_000),
    Status: 'Completed',
    Priority: 'Normal',
    TaskSubtype: 'Email',
    ActivityDate: activityDate.toISOString().slice(0, 10),
    ...(ownerId ? { OwnerId: ownerId } : {}),
  }

  try {
    const sfTaskId = await client.create('Task', fields)
    await prisma.salesforceSyncJob.update({ where: { id: job.id }, data: { status: 'DONE', sfTaskId, lastError: null } })
    return 'done'
  } catch (err) {
    if (err instanceof SalesforceApiError && DELETED_REF_CODES.has(err.errorCode)) {
      // The link is stale: clear only the Salesforce link fields, scoped to
      // the id we just tried (a newer link written concurrently must
      // survive), and never touch the pre-send check fields (sfCheck*,
      // sfBlockOverride, sfHeldSince) — those are unrelated to activity
      // logging and an admin's override must not be silently discarded.
      await prisma.lead.updateMany({
        where: { id: job.leadId, salesforceId: lead.salesforceId },
        data: { salesforceId: null, salesforceType: null, salesforceAccountId: null },
      })

      if (job.type === 'LOG_REPLY') {
        // Never convert this job to CREATE_LEAD in place — a CREATE_LEAD row
        // for the same inboundReplyId may already exist (e.g. the reply that
        // originally created this now-deleted record), and an in-place type
        // change would collide with @@unique([type, inboundReplyId]). Fail
        // this job and ensure a CREATE_LEAD job separately instead.
        await prisma.salesforceSyncJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', lastError: 'Salesforce record deleted; recreating the lead' },
        })
        await ensureCreateLeadJob(job.organizationId, job.leadId, job.inboundReplyId!, now)
        return 'failed'
      }

      await prisma.salesforceSyncJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', lastError: `${err.errorCode}: ${err.message}` },
      })
      return 'failed'
    }
    throw err
  }
}

/**
 * Ensures a PENDING CREATE_LEAD job exists for this reply. Resets an
 * existing row (rather than creating a second one) so this never collides
 * with @@unique([type, inboundReplyId]).
 */
async function ensureCreateLeadJob(organizationId: string, leadId: string, inboundReplyId: string, now: Date): Promise<void> {
  const reset = await prisma.salesforceSyncJob.updateMany({
    where: { type: 'CREATE_LEAD', inboundReplyId },
    data: { status: 'PENDING', attempts: 0, nextAttemptAt: now, lastError: null },
  })
  if (reset.count === 0) {
    await prisma.salesforceSyncJob.create({
      data: { organizationId, leadId, type: 'CREATE_LEAD', inboundReplyId, status: 'PENDING', attempts: 0, nextAttemptAt: now },
    })
  }
}

/** CREATE_LEAD: finds or creates the Salesforce record for a reply from an unlinked lead, links it, then logs the reply history. */
async function processCreateLead(client: SfClient, job: JobRow, now: Date): Promise<Outcome> {
  const lead = await prisma.lead.findUnique({
    where: { id: job.leadId },
    select: {
      id: true, organizationId: true, email: true, firstName: true, lastName: true,
      company: true, title: true, phone: true, ownerId: true, salesforceId: true,
    },
  })
  if (!lead) {
    await prisma.salesforceSyncJob.update({ where: { id: job.id }, data: { status: 'FAILED', lastError: 'Lead no longer exists' } })
    return 'failed'
  }

  if (!lead.salesforceId) {
    const contacts = await fetchPeople(client, 'Contact', { emails: [lead.email] })
    const leadMatches = (await fetchPeople(client, 'Lead', { emails: [lead.email] })).filter((l) => !l.isConverted)
    const match = contacts[0] ?? leadMatches[0]

    let salesforceId: string
    let salesforceType: 'LEAD' | 'CONTACT'
    let salesforceAccountId: string | null
    if (match) {
      salesforceId = match.id
      salesforceType = match.type
      salesforceAccountId = match.accountId
    } else {
      const ownerId = await resolveSfUserId(client, lead.organizationId, lead.ownerId)
      salesforceId = await client.create('Lead', {
        FirstName: lead.firstName,
        LastName: lead.lastName ?? lead.email.split('@')[0],
        Company: lead.company ?? 'Unknown',
        Email: lead.email,
        Title: lead.title,
        Phone: lead.phone,
        LeadSource: 'OutboundOS',
        ...(ownerId ? { OwnerId: ownerId } : {}),
      })
      salesforceType = 'LEAD'
      salesforceAccountId = null
    }

    const linked = await prisma.lead.updateMany({
      where: { id: lead.id, salesforceId: null },
      data: { salesforceId, salesforceType, salesforceAccountId },
    })

    if (linked.count > 0) {
      // This job just (re)linked the lead. Any history already logged
      // against its OLD record (DONE Tasks that no longer exist there, or
      // FAILED rows) is stale on the new one — reset it to PENDING so it
      // gets re-created there. Rows that don't exist yet are handled by
      // enqueueHistory's createMany below.
      await prisma.salesforceSyncJob.updateMany({
        where: { leadId: lead.id, type: { in: LOG_JOB_TYPES }, status: { in: DONE_OR_FAILED } },
        data: { status: 'PENDING', attempts: 0, sfTaskId: null, lastError: null, nextAttemptAt: now },
      })
    } else if (!match) {
      // We created a brand-new Salesforce Lead, but the link write matched
      // no rows — the lead was linked concurrently by something else. The
      // Lead we just created in Salesforce has nothing pointing to it.
      console.warn(`[salesforce] created Lead ${salesforceId} for lead ${lead.id}, but it was already linked when we tried to save the link — the new Lead may be orphaned`)
    }
  }

  await enqueueHistory(job.organizationId, lead.id)
  await prisma.salesforceSyncJob.update({ where: { id: job.id }, data: { status: 'DONE', lastError: null } })
  return 'done'
}

/** Backfills LOG_SEND/LOG_REPLY jobs for every SENT message and every reply of a newly-linked lead, including the one that triggered CREATE_LEAD. */
async function enqueueHistory(organizationId: string, leadId: string): Promise<void> {
  const [sent, replies] = await Promise.all([
    prisma.outboundMessage.findMany({ where: { leadId, status: 'SENT' }, select: { id: true } }),
    prisma.inboundReply.findMany({ where: { leadId }, select: { id: true } }),
  ])
  const data = [
    ...sent.map((m) => ({ organizationId, leadId, type: 'LOG_SEND' as const, outboundMessageId: m.id })),
    ...replies.map((r) => ({ organizationId, leadId, type: 'LOG_REPLY' as const, inboundReplyId: r.id })),
  ]
  if (data.length > 0) {
    await prisma.salesforceSyncJob.createMany({ data, skipDuplicates: true })
  }
}

async function recordGenericFailure(job: JobRow, err: unknown, now: Date): Promise<Outcome> {
  const attempts = job.attempts + 1
  const lastError = err instanceof SalesforceApiError ? `${err.errorCode}: ${err.message}` : err instanceof Error ? err.message : String(err)

  if (attempts >= MAX_ATTEMPTS) {
    await prisma.salesforceSyncJob.update({ where: { id: job.id }, data: { status: 'FAILED', attempts, lastError } })
    return 'failed'
  }
  await prisma.salesforceSyncJob.update({
    where: { id: job.id },
    data: { attempts, nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[attempts - 1]!), lastError },
  })
  return 'retried'
}
