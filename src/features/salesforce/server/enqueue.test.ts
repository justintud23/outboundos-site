import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findUnique: vi.fn() },
    salesforceSyncJob: { createMany: vi.fn() },
  },
}))
vi.mock('./connection', () => ({ getConnection: vi.fn() }))

import { prisma } from '@/lib/db/prisma'
import { getConnection } from './connection'
import { enqueueSendLog, enqueueReplyLog } from './enqueue'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  lead: { findUnique: Fn }
  salesforceSyncJob: { createMany: Fn }
}
const mockGetConnection = getConnection as unknown as Fn

const CONNECTED = { logActivity: true }

beforeEach(() => {
  vi.clearAllMocks()
  mockGetConnection.mockResolvedValue(CONNECTED)
  p.lead.findUnique.mockResolvedValue({ salesforceId: null })
  p.salesforceSyncJob.createMany.mockResolvedValue({ count: 0 })
})

describe('enqueueSendLog', () => {
  it('does nothing when there is no Salesforce connection', async () => {
    mockGetConnection.mockResolvedValue(null)
    await enqueueSendLog('org-1', 'lead-1', 'om-1')
    expect(p.salesforceSyncJob.createMany).not.toHaveBeenCalled()
  })

  it('does nothing when logActivity is off', async () => {
    mockGetConnection.mockResolvedValue({ logActivity: false })
    await enqueueSendLog('org-1', 'lead-1', 'om-1')
    expect(p.salesforceSyncJob.createMany).not.toHaveBeenCalled()
  })

  it('does nothing for a lead not linked to Salesforce', async () => {
    p.lead.findUnique.mockResolvedValue({ salesforceId: null })
    await enqueueSendLog('org-1', 'lead-1', 'om-1')
    expect(p.salesforceSyncJob.createMany).not.toHaveBeenCalled()
  })

  it('enqueues LOG_SEND for a linked lead, skipping duplicates', async () => {
    p.lead.findUnique.mockResolvedValue({ salesforceId: '00Qxxx' })
    await enqueueSendLog('org-1', 'lead-1', 'om-1')
    expect(p.salesforceSyncJob.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: 'org-1', leadId: 'lead-1', type: 'LOG_SEND', outboundMessageId: 'om-1' }],
      skipDuplicates: true,
    })
  })

  it('swallows a Prisma error instead of throwing', async () => {
    p.lead.findUnique.mockResolvedValue({ salesforceId: '00Qxxx' })
    p.salesforceSyncJob.createMany.mockRejectedValue(new Error('db down'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(enqueueSendLog('org-1', 'lead-1', 'om-1')).resolves.toBeUndefined()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})

describe('enqueueReplyLog', () => {
  it('does nothing when there is no Salesforce connection', async () => {
    mockGetConnection.mockResolvedValue(null)
    await enqueueReplyLog('org-1', 'lead-1', 'ir-1')
    expect(p.salesforceSyncJob.createMany).not.toHaveBeenCalled()
  })

  it('does nothing when logActivity is off', async () => {
    mockGetConnection.mockResolvedValue({ logActivity: false })
    await enqueueReplyLog('org-1', 'lead-1', 'ir-1')
    expect(p.salesforceSyncJob.createMany).not.toHaveBeenCalled()
  })

  it('enqueues CREATE_LEAD for a reply from an unlinked lead', async () => {
    p.lead.findUnique.mockResolvedValue({ salesforceId: null })
    await enqueueReplyLog('org-1', 'lead-1', 'ir-1')
    expect(p.salesforceSyncJob.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: 'org-1', leadId: 'lead-1', type: 'CREATE_LEAD', inboundReplyId: 'ir-1' }],
      skipDuplicates: true,
    })
  })

  it('enqueues LOG_REPLY for a reply from a linked lead', async () => {
    p.lead.findUnique.mockResolvedValue({ salesforceId: '00Qxxx' })
    await enqueueReplyLog('org-1', 'lead-1', 'ir-1')
    expect(p.salesforceSyncJob.createMany).toHaveBeenCalledWith({
      data: [{ organizationId: 'org-1', leadId: 'lead-1', type: 'LOG_REPLY', inboundReplyId: 'ir-1' }],
      skipDuplicates: true,
    })
  })

  it('swallows a Prisma error instead of throwing', async () => {
    p.lead.findUnique.mockRejectedValue(new Error('db down'))
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(enqueueReplyLog('org-1', 'lead-1', 'ir-1')).resolves.toBeUndefined()
    expect(consoleErrorSpy).toHaveBeenCalled()
    consoleErrorSpy.mockRestore()
  })
})
