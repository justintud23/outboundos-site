import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    salesforceSyncJob: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), createMany: vi.fn(), create: vi.fn() },
    lead: { findUnique: vi.fn(), updateMany: vi.fn() },
    outboundMessage: { findMany: vi.fn() },
    inboundReply: { findMany: vi.fn() },
  },
}))
vi.mock('./connection', () => ({
  releaseExpiredRateLimits: vi.fn(),
}))
vi.mock('./client', () => ({ getSalesforceClient: vi.fn() }))
vi.mock('./owner-match', () => ({ resolveSfUserId: vi.fn() }))
vi.mock('./records', () => ({ fetchPeople: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { releaseExpiredRateLimits } from './connection'
import { getSalesforceClient } from './client'
import { resolveSfUserId } from './owner-match'
import { fetchPeople } from './records'
import { SalesforceApiError, SalesforceAuthError, SalesforceRateLimitError } from './errors'
import type { SfClient } from './client'
import { processSalesforceJobs, BACKOFF_MS, MAX_ATTEMPTS } from './process-jobs'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  salesforceSyncJob: { findMany: Fn; update: Fn; updateMany: Fn; createMany: Fn; create: Fn }
  lead: { findUnique: Fn; updateMany: Fn }
  outboundMessage: { findMany: Fn }
  inboundReply: { findMany: Fn }
}
const mockReleaseExpiredRateLimits = releaseExpiredRateLimits as unknown as Fn
const mockGetSalesforceClient = getSalesforceClient as unknown as Fn
const mockResolveSfUserId = resolveSfUserId as unknown as Fn
const mockFetchPeople = fetchPeople as unknown as Fn

const NOW = new Date('2026-09-29T12:00:00.000Z')

function fakeClient(create: Fn = vi.fn()): SfClient {
  return { orgId: 'org-1', query: vi.fn(), listViews: vi.fn(), listViewIds: vi.fn(), create } as unknown as SfClient
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    organizationId: 'org-1',
    leadId: 'lead-1',
    type: 'LOG_SEND',
    outboundMessageId: 'om-1',
    inboundReplyId: null,
    status: 'PENDING',
    attempts: 0,
    nextAttemptAt: NOW,
    lastError: null,
    sfTaskId: null,
    createdAt: NOW,
    updatedAt: NOW,
    lead: {
      id: 'lead-1', organizationId: 'org-1', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
      company: 'Acme', title: 'VP Ops', phone: '555-1000', ownerId: 'mem-1', salesforceId: '00Qxxx', salesforceType: 'LEAD',
    },
    outboundMessage: { subject: 'Hello Jane', body: 'Hi Jane, ...', sentAt: new Date('2026-09-20T10:00:00Z') },
    inboundReply: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReleaseExpiredRateLimits.mockResolvedValue(undefined)
  mockGetSalesforceClient.mockReturnValue(fakeClient())
  mockResolveSfUserId.mockResolvedValue('005OWNER')
  mockFetchPeople.mockResolvedValue([])
  p.salesforceSyncJob.findMany.mockResolvedValue([])
  p.salesforceSyncJob.update.mockResolvedValue({})
  p.salesforceSyncJob.updateMany.mockResolvedValue({ count: 0 })
  p.salesforceSyncJob.createMany.mockResolvedValue({ count: 0 })
  p.salesforceSyncJob.create.mockResolvedValue({})
  p.lead.findUnique.mockResolvedValue({ salesforceId: '00Qxxx', ownerId: 'mem-1' })
  p.lead.updateMany.mockResolvedValue({ count: 1 })
  p.outboundMessage.findMany.mockResolvedValue([])
  p.inboundReply.findMany.mockResolvedValue([])
})

describe('processSalesforceJobs', () => {
  it('calls releaseExpiredRateLimits before loading jobs', async () => {
    const order: string[] = []
    mockReleaseExpiredRateLimits.mockImplementation(async () => { order.push('release') })
    p.salesforceSyncJob.findMany.mockImplementation(async () => { order.push('findMany'); return [] })
    await processSalesforceJobs({ now: NOW })
    expect(order).toEqual(['release', 'findMany'])
  })

  it('LOG_SEND: creates a Task with the exact fields, truncated, and marks the job DONE', async () => {
    const create = vi.fn().mockResolvedValue('00Txxx')
    mockGetSalesforceClient.mockReturnValue(fakeClient(create))
    p.salesforceSyncJob.findMany.mockResolvedValue([
      job({ outboundMessage: { subject: 'S'.repeat(300), body: 'B'.repeat(40_000), sentAt: new Date('2026-09-20T10:00:00Z') } }),
    ])

    const result = await processSalesforceJobs({ now: NOW })

    expect(create).toHaveBeenCalledWith('Task', {
      WhoId: '00Qxxx',
      Subject: `Email: ${'S'.repeat(300)}`.slice(0, 255),
      Description: 'B'.repeat(32_000),
      Status: 'Completed',
      Priority: 'Normal',
      TaskSubtype: 'Email',
      ActivityDate: '2026-09-20',
      OwnerId: '005OWNER',
    })
    expect((create.mock.calls[0]![1] as { Subject: string }).Subject.length).toBe(255)
    expect((create.mock.calls[0]![1] as { Description: string }).Description.length).toBe(32_000)
    expect(p.salesforceSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'DONE', sfTaskId: '00Txxx', lastError: null },
    })
    expect(result.done).toBe(1)
  })

  it('LOG_SEND: resolveSfUserId throwing is treated like any other job error and goes through backoff, no Task is created', async () => {
    mockResolveSfUserId.mockRejectedValue(new Error('owner lookup failed'))
    const create = vi.fn()
    mockGetSalesforceClient.mockReturnValue(fakeClient(create))
    p.salesforceSyncJob.findMany.mockResolvedValue([job({ attempts: 0 })])

    const result = await processSalesforceJobs({ now: NOW })

    expect(create).not.toHaveBeenCalled()
    expect(p.salesforceSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { attempts: 1, nextAttemptAt: new Date(NOW.getTime() + BACKOFF_MS[0]!), lastError: 'owner lookup failed' },
    })
    expect(result.retried).toBe(1)
  })

  it('LOG_SEND: omits OwnerId when resolveSfUserId returns an empty string', async () => {
    mockResolveSfUserId.mockResolvedValue('')
    const create = vi.fn().mockResolvedValue('00Txxx')
    mockGetSalesforceClient.mockReturnValue(fakeClient(create))
    p.salesforceSyncJob.findMany.mockResolvedValue([job()])

    await processSalesforceJobs({ now: NOW })

    const fields = create.mock.calls[0]![1] as Record<string, unknown>
    expect('OwnerId' in fields).toBe(false)
  })

  it('LOG_REPLY: uses "Reply:" and the reply body', async () => {
    const create = vi.fn().mockResolvedValue('00Txxx')
    mockGetSalesforceClient.mockReturnValue(fakeClient(create))
    p.salesforceSyncJob.findMany.mockResolvedValue([
      job({
        type: 'LOG_REPLY', outboundMessageId: null, inboundReplyId: 'ir-1', outboundMessage: null,
        inboundReply: { subject: 'Re: Hello', rawBody: 'Sounds good', receivedAt: new Date('2026-09-21T09:00:00Z'), createdAt: new Date('2026-09-21T09:00:01Z') },
      }),
    ])

    await processSalesforceJobs({ now: NOW })

    expect(create).toHaveBeenCalledWith('Task', expect.objectContaining({
      Subject: 'Reply: Re: Hello',
      Description: 'Sounds good',
      ActivityDate: '2026-09-21',
    }))
  })

  it('a job whose lead has no salesforceId (re-read) is marked FAILED, no Task is created', async () => {
    p.lead.findUnique.mockResolvedValue({ salesforceId: null, ownerId: 'mem-1' })
    const create = vi.fn()
    mockGetSalesforceClient.mockReturnValue(fakeClient(create))
    p.salesforceSyncJob.findMany.mockResolvedValue([job()])

    const result = await processSalesforceJobs({ now: NOW })

    expect(create).not.toHaveBeenCalled()
    expect(p.salesforceSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'FAILED', lastError: 'Lead is not linked to Salesforce' },
    })
    expect(result.failed).toBe(1)
  })

  describe('CREATE_LEAD', () => {
    function createLeadJob(overrides: Record<string, unknown> = {}) {
      return job({
        type: 'CREATE_LEAD', outboundMessageId: null, inboundReplyId: 'ir-1', outboundMessage: null,
        inboundReply: { subject: 'Re: Hello', rawBody: 'Interested', receivedAt: new Date('2026-09-21T09:00:00Z'), createdAt: new Date('2026-09-21T09:00:01Z') },
        lead: { id: 'lead-1', organizationId: 'org-1', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe', company: 'Acme', title: 'VP Ops', phone: '555-1000', ownerId: 'mem-1', salesforceId: null, salesforceType: null },
        ...overrides,
      })
    }

    it('an existing Contact is found: links the lead and never calls create(Lead)', async () => {
      p.lead.findUnique.mockResolvedValue({
        id: 'lead-1', organizationId: 'org-1', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
        company: 'Acme', title: 'VP Ops', phone: '555-1000', ownerId: 'mem-1', salesforceId: null,
      })
      mockFetchPeople.mockImplementation(async (_c: unknown, obj: 'Lead' | 'Contact') =>
        obj === 'Contact' ? [{ type: 'CONTACT', id: '003CONTACT', accountId: '001ACC', isConverted: false }] : [],
      )
      const create = vi.fn()
      mockGetSalesforceClient.mockReturnValue(fakeClient(create))
      p.outboundMessage.findMany.mockResolvedValue([])
      p.inboundReply.findMany.mockResolvedValue([{ id: 'ir-1' }])
      p.salesforceSyncJob.findMany.mockResolvedValue([createLeadJob()])

      const result = await processSalesforceJobs({ now: NOW })

      expect(create).not.toHaveBeenCalledWith('Lead', expect.anything())
      expect(p.lead.updateMany).toHaveBeenCalledWith({
        where: { id: 'lead-1', salesforceId: null },
        data: { salesforceId: '003CONTACT', salesforceType: 'CONTACT', salesforceAccountId: '001ACC' },
      })
      expect(p.salesforceSyncJob.update).toHaveBeenCalledWith({ where: { id: 'job-1' }, data: { status: 'DONE', lastError: null } })
      expect(result.done).toBe(1)
    })

    it('no match found: creates the Salesforce Lead with fallbacks and LeadSource, then enqueues history for 2 sends and 1 reply', async () => {
      p.lead.findUnique.mockResolvedValue({
        id: 'lead-1', organizationId: 'org-1', email: 'jane@acme.com', firstName: null, lastName: null,
        company: null, title: 'VP Ops', phone: '555-1000', ownerId: 'mem-1', salesforceId: null,
      })
      mockFetchPeople.mockResolvedValue([])
      const create = vi.fn().mockResolvedValue('00QNEW')
      mockGetSalesforceClient.mockReturnValue(fakeClient(create))
      p.outboundMessage.findMany.mockResolvedValue([{ id: 'om-1' }, { id: 'om-2' }])
      p.inboundReply.findMany.mockResolvedValue([{ id: 'ir-1' }])
      p.salesforceSyncJob.findMany.mockResolvedValue([createLeadJob()])

      const result = await processSalesforceJobs({ now: NOW })

      expect(create).toHaveBeenCalledWith('Lead', {
        FirstName: null,
        LastName: 'jane',
        Company: 'Unknown',
        Email: 'jane@acme.com',
        Title: 'VP Ops',
        Phone: '555-1000',
        LeadSource: 'Outwyn',
        OwnerId: '005OWNER',
      })
      expect(p.lead.updateMany).toHaveBeenCalledWith({
        where: { id: 'lead-1', salesforceId: null },
        data: { salesforceId: '00QNEW', salesforceType: 'LEAD', salesforceAccountId: null },
      })
      expect(p.salesforceSyncJob.createMany).toHaveBeenCalledWith({
        data: [
          { organizationId: 'org-1', leadId: 'lead-1', type: 'LOG_SEND', outboundMessageId: 'om-1' },
          { organizationId: 'org-1', leadId: 'lead-1', type: 'LOG_SEND', outboundMessageId: 'om-2' },
          { organizationId: 'org-1', leadId: 'lead-1', type: 'LOG_REPLY', inboundReplyId: 'ir-1' },
        ],
        skipDuplicates: true,
      })
      expect(result.done).toBe(1)
    })

    it('Review Focus 6: two CREATE_LEAD jobs for the same lead in one run — the second finds it linked and skips create(Lead)', async () => {
      p.lead.findUnique
        .mockResolvedValueOnce({
          id: 'lead-1', organizationId: 'org-1', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
          company: 'Acme', title: 'VP Ops', phone: '555-1000', ownerId: 'mem-1', salesforceId: null,
        })
        .mockResolvedValueOnce({
          id: 'lead-1', organizationId: 'org-1', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
          company: 'Acme', title: 'VP Ops', phone: '555-1000', ownerId: 'mem-1', salesforceId: '00QNEW',
        })
      mockFetchPeople.mockResolvedValue([])
      const create = vi.fn().mockResolvedValue('00QNEW')
      mockGetSalesforceClient.mockReturnValue(fakeClient(create))
      p.salesforceSyncJob.findMany.mockResolvedValue([
        createLeadJob({ id: 'job-1', inboundReplyId: 'ir-1' }),
        createLeadJob({ id: 'job-2', inboundReplyId: 'ir-2', inboundReply: { subject: 'Re: two', rawBody: 'second', receivedAt: new Date('2026-09-22T09:00:00Z'), createdAt: new Date('2026-09-22T09:00:01Z') } }),
      ])

      const result = await processSalesforceJobs({ now: NOW })

      expect(create).toHaveBeenCalledTimes(1)
      expect(result.done).toBe(2)
    })

    it('linking a lead (found or created) resets its prior DONE/FAILED LOG_SEND/LOG_REPLY jobs to PENDING for re-logging on the new record', async () => {
      p.lead.findUnique.mockResolvedValue({
        id: 'lead-1', organizationId: 'org-1', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
        company: 'Acme', title: 'VP Ops', phone: '555-1000', ownerId: 'mem-1', salesforceId: null,
      })
      mockFetchPeople.mockResolvedValue([])
      const create = vi.fn().mockResolvedValue('00QNEW')
      mockGetSalesforceClient.mockReturnValue(fakeClient(create))
      p.lead.updateMany.mockResolvedValue({ count: 1 })
      p.salesforceSyncJob.findMany.mockResolvedValue([createLeadJob()])

      await processSalesforceJobs({ now: NOW })

      expect(p.salesforceSyncJob.updateMany).toHaveBeenCalledWith({
        where: { leadId: 'lead-1', type: { in: ['LOG_SEND', 'LOG_REPLY'] }, status: { in: ['DONE', 'FAILED'] } },
        data: { status: 'PENDING', attempts: 0, sfTaskId: null, lastError: null, nextAttemptAt: NOW },
      })
    })

    it('does not reset LOG jobs when the lead was already linked (nothing was just linked)', async () => {
      p.lead.findUnique.mockResolvedValue({
        id: 'lead-1', organizationId: 'org-1', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
        company: 'Acme', title: 'VP Ops', phone: '555-1000', ownerId: 'mem-1', salesforceId: '00QEXIST',
      })
      p.salesforceSyncJob.findMany.mockResolvedValue([createLeadJob()])

      await processSalesforceJobs({ now: NOW })

      expect(p.salesforceSyncJob.updateMany).not.toHaveBeenCalled()
    })

    it('warns (with the new Salesforce id) when a created Lead ends up orphaned because the link write matched 0 rows', async () => {
      p.lead.findUnique.mockResolvedValue({
        id: 'lead-1', organizationId: 'org-1', email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe',
        company: 'Acme', title: 'VP Ops', phone: '555-1000', ownerId: 'mem-1', salesforceId: null,
      })
      mockFetchPeople.mockResolvedValue([])
      const create = vi.fn().mockResolvedValue('00QORPHAN')
      mockGetSalesforceClient.mockReturnValue(fakeClient(create))
      p.lead.updateMany.mockResolvedValue({ count: 0 }) // linked concurrently by something else
      p.salesforceSyncJob.findMany.mockResolvedValue([createLeadJob()])
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await processSalesforceJobs({ now: NOW })

      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('00QORPHAN'))
      expect(p.salesforceSyncJob.updateMany).not.toHaveBeenCalled()
      consoleWarnSpy.mockRestore()
    })
  })

  it('an auth error leaves the job PENDING with attempts unchanged, and skips the rest of the org\'s jobs', async () => {
    const create = vi.fn().mockRejectedValue(new SalesforceAuthError())
    mockGetSalesforceClient.mockReturnValue(fakeClient(create))
    p.salesforceSyncJob.findMany.mockResolvedValue([job({ id: 'job-1' }), job({ id: 'job-2', outboundMessageId: 'om-2' })])

    const result = await processSalesforceJobs({ now: NOW })

    expect(p.salesforceSyncJob.update).not.toHaveBeenCalled()
    expect(result.skippedOrgs).toBe(1)
    expect(result.done).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.retried).toBe(0)
  })

  it('a rate-limit error leaves the job PENDING with attempts unchanged, and skips the rest of the org\'s jobs', async () => {
    const create = vi.fn().mockRejectedValue(new SalesforceRateLimitError())
    mockGetSalesforceClient.mockReturnValue(fakeClient(create))
    p.salesforceSyncJob.findMany.mockResolvedValue([job({ id: 'job-1', attempts: 2 }), job({ id: 'job-2', outboundMessageId: 'om-2' })])

    const result = await processSalesforceJobs({ now: NOW })

    expect(p.salesforceSyncJob.update).not.toHaveBeenCalled()
    expect(result.skippedOrgs).toBe(1)
    expect(result.done).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.retried).toBe(0)
  })

  it('a generic error with attempts 0 sets attempts:1 and nextAttemptAt = now + 5 min', async () => {
    const create = vi.fn().mockRejectedValue(new Error('network blip'))
    mockGetSalesforceClient.mockReturnValue(fakeClient(create))
    p.salesforceSyncJob.findMany.mockResolvedValue([job({ attempts: 0 })])

    const result = await processSalesforceJobs({ now: NOW })

    expect(p.salesforceSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { attempts: 1, nextAttemptAt: new Date(NOW.getTime() + BACKOFF_MS[0]!), lastError: 'network blip' },
    })
    expect(result.retried).toBe(1)
  })

  it('a generic error at attempts 5 marks the job FAILED (MAX_ATTEMPTS reached)', async () => {
    expect(MAX_ATTEMPTS).toBe(6)
    const create = vi.fn().mockRejectedValue(new Error('still failing'))
    mockGetSalesforceClient.mockReturnValue(fakeClient(create))
    p.salesforceSyncJob.findMany.mockResolvedValue([job({ attempts: 5 })])

    const result = await processSalesforceJobs({ now: NOW })

    expect(p.salesforceSyncJob.update).toHaveBeenCalledWith({
      where: { id: 'job-1' },
      data: { status: 'FAILED', attempts: 6, lastError: 'still failing' },
    })
    expect(result.failed).toBe(1)
  })

  describe('deleted-record path (ENTITY_IS_DELETED / NOT_FOUND on a Task create)', () => {
    it('INVALID_CROSS_REFERENCE_KEY (e.g. a stale OwnerId) is not treated as a deleted record: the link is kept and the job retries (M1)', async () => {
      const create = vi.fn().mockRejectedValue(new SalesforceApiError(400, 'INVALID_CROSS_REFERENCE_KEY', 'invalid cross reference id'))
      mockGetSalesforceClient.mockReturnValue(fakeClient(create))
      p.lead.findUnique.mockResolvedValue({ salesforceId: '00SLIVE', ownerId: 'mem-1' })
      p.salesforceSyncJob.findMany.mockResolvedValue([job({ attempts: 0 })])

      const result = await processSalesforceJobs({ now: NOW })

      expect(p.lead.updateMany).not.toHaveBeenCalled()
      expect(p.salesforceSyncJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { attempts: 1, nextAttemptAt: new Date(NOW.getTime() + BACKOFF_MS[0]!), lastError: expect.stringContaining('invalid cross reference id') },
      })
      expect(result.retried).toBe(1)
    })

    it('clears only salesforceId/Type/AccountId, scoped to the stale id — sfCheckStatus and sfBlockOverride are never touched', async () => {
      const create = vi.fn().mockRejectedValue(new SalesforceApiError(400, 'NOT_FOUND', 'not found'))
      mockGetSalesforceClient.mockReturnValue(fakeClient(create))
      p.lead.findUnique.mockResolvedValue({ salesforceId: '00STALE', ownerId: 'mem-1' })
      p.salesforceSyncJob.findMany.mockResolvedValue([job()])

      await processSalesforceJobs({ now: NOW })

      expect(p.lead.updateMany).toHaveBeenCalledWith({
        where: { id: 'lead-1', salesforceId: '00STALE' },
        data: { salesforceId: null, salesforceType: null, salesforceAccountId: null },
      })
      const data = p.lead.updateMany.mock.calls[0]![0].data as Record<string, unknown>
      expect(data).not.toHaveProperty('sfCheckStatus')
      expect(data).not.toHaveProperty('sfCheckedAt')
      expect(data).not.toHaveProperty('sfCheckDetail')
      expect(data).not.toHaveProperty('sfBlockOverride')
      expect(data).not.toHaveProperty('sfHeldSince')
    })

    it('on a LOG_SEND Task create: clears the link and marks the job FAILED with the Salesforce error', async () => {
      const create = vi.fn().mockRejectedValue(new SalesforceApiError(400, 'NOT_FOUND', 'not found'))
      mockGetSalesforceClient.mockReturnValue(fakeClient(create))
      p.salesforceSyncJob.findMany.mockResolvedValue([job()])

      const result = await processSalesforceJobs({ now: NOW })

      expect(p.salesforceSyncJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'FAILED', lastError: 'NOT_FOUND: not found' },
      })
      expect(result.failed).toBe(1)
    })

    it('on a LOG_REPLY Task create: fails that job (never converts it in place) and ensures a CREATE_LEAD job for the same reply', async () => {
      const create = vi.fn().mockRejectedValue(new SalesforceApiError(400, 'ENTITY_IS_DELETED', 'entity is deleted'))
      mockGetSalesforceClient.mockReturnValue(fakeClient(create))
      p.salesforceSyncJob.findMany.mockResolvedValue([
        job({ type: 'LOG_REPLY', outboundMessageId: null, inboundReplyId: 'ir-1', outboundMessage: null,
          inboundReply: { subject: 'Re: Hello', rawBody: 'ok', receivedAt: new Date('2026-09-21T09:00:00Z'), createdAt: new Date('2026-09-21T09:00:01Z') } }),
      ])
      p.salesforceSyncJob.updateMany.mockResolvedValue({ count: 0 }) // no existing CREATE_LEAD row for ir-1

      const result = await processSalesforceJobs({ now: NOW })

      expect(p.salesforceSyncJob.update).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: { status: 'FAILED', lastError: 'Salesforce record deleted; recreating the lead' },
      })
      expect(p.salesforceSyncJob.updateMany).toHaveBeenCalledWith({
        where: { type: 'CREATE_LEAD', inboundReplyId: 'ir-1' },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: NOW, lastError: null },
      })
      expect(p.salesforceSyncJob.create).toHaveBeenCalledWith({
        data: { organizationId: 'org-1', leadId: 'lead-1', type: 'CREATE_LEAD', inboundReplyId: 'ir-1', status: 'PENDING', attempts: 0, nextAttemptAt: NOW },
      })
      expect(result.failed).toBe(1)
    })

    it('resets an existing CREATE_LEAD row for the same reply instead of creating a second one (no unique violation)', async () => {
      const create = vi.fn().mockRejectedValue(new SalesforceApiError(400, 'ENTITY_IS_DELETED', 'entity is deleted'))
      mockGetSalesforceClient.mockReturnValue(fakeClient(create))
      p.salesforceSyncJob.findMany.mockResolvedValue([
        job({ type: 'LOG_REPLY', outboundMessageId: null, inboundReplyId: 'ir-1', outboundMessage: null,
          inboundReply: { subject: 'Re: Hello', rawBody: 'ok', receivedAt: new Date('2026-09-21T09:00:00Z'), createdAt: new Date('2026-09-21T09:00:01Z') } }),
      ])
      p.salesforceSyncJob.updateMany.mockResolvedValue({ count: 1 }) // an existing CREATE_LEAD row for ir-1 was reset

      const result = await processSalesforceJobs({ now: NOW })

      expect(p.salesforceSyncJob.updateMany).toHaveBeenCalledWith({
        where: { type: 'CREATE_LEAD', inboundReplyId: 'ir-1' },
        data: { status: 'PENDING', attempts: 0, nextAttemptAt: NOW, lastError: null },
      })
      expect(p.salesforceSyncJob.create).not.toHaveBeenCalled()
      expect(result.failed).toBe(1)
    })
  })

  it('stops processing once the budget is spent (driven by a virtual clock advanced only by actual Salesforce calls)', async () => {
    let virtualNow = 1_000_000
    const clock = () => virtualNow
    const create = vi.fn().mockImplementation(async () => {
      virtualNow += 700 // simulate this job's Task create taking 700ms
      return '00Txxx'
    })
    mockGetSalesforceClient.mockReturnValue(fakeClient(create))
    p.salesforceSyncJob.findMany.mockResolvedValue([
      job({ id: 'job-1', organizationId: 'org-1' }),
      job({ id: 'job-2', organizationId: 'org-2', outboundMessageId: 'om-2' }),
      job({ id: 'job-3', organizationId: 'org-3', outboundMessageId: 'om-3' }),
    ])

    const result = await processSalesforceJobs({ now: NOW, budgetMs: 1_000, clock })

    // After org-1 (700ms) and org-2 (1400ms, over the 1000ms budget), org-3
    // is never reached — regardless of how many times the budget check
    // itself calls the clock.
    expect(create).toHaveBeenCalledTimes(2)
    expect(result.done).toBe(2)
  })
})
