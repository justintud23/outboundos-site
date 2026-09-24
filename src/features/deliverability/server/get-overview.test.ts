import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: { findUniqueOrThrow: vi.fn() },
    mailbox: { findMany: vi.fn() },
    domainHealth: { findMany: vi.fn() },
    outboundMessage: { findMany: vi.fn(), count: vi.fn() },
    messageEvent: { findMany: vi.fn() },
    inboundReply: { findMany: vi.fn() },
  },
}))

const { buildOverviewMock } = vi.hoisted(() => ({ buildOverviewMock: vi.fn(() => ({ fake: 'overview' })) }))
vi.mock('../overview', () => ({ buildOverview: buildOverviewMock }))

import { prisma } from '@/lib/db/prisma'
import { getDeliverabilityOverview } from './get-overview'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  organization: { findUniqueOrThrow: Fn }
  mailbox: { findMany: Fn }
  domainHealth: { findMany: Fn }
  outboundMessage: { findMany: Fn; count: Fn }
  messageEvent: { findMany: Fn }
  inboundReply: { findMany: Fn }
}

const NOW = new Date('2026-09-25T16:00:00Z')
const ORG_ID = 'org-1'

function setup(orgOverrides: Record<string, unknown> = {}) {
  p.organization.findUniqueOrThrow.mockResolvedValue({ timezone: 'America/New_York', msTenantId: null, ...orgOverrides })
  p.mailbox.findMany.mockResolvedValue([{ id: 'mb-1' }])
  p.domainHealth.findMany.mockResolvedValue([{ id: 'dh-1' }])
  p.outboundMessage.findMany.mockResolvedValue([{ mailboxId: 'mb-1', sentAt: NOW }])
  p.messageEvent.findMany.mockResolvedValue([{ createdAt: NOW, outboundMessage: { mailboxId: 'mb-1' } }])
  p.inboundReply.findMany.mockResolvedValue([{ mailboxId: 'mb-1', receivedAt: NOW }])
  p.outboundMessage.count.mockResolvedValue(3)
}

describe('getDeliverabilityOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    buildOverviewMock.mockReturnValue({ fake: 'overview' } as never)
  })

  it('scopes every query to the organization', async () => {
    setup()
    await getDeliverabilityOverview(ORG_ID, NOW)

    expect(p.organization.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: ORG_ID }, select: { timezone: true, msTenantId: true } })
    expect(p.mailbox.findMany.mock.calls[0]![0].where).toMatchObject({ organizationId: ORG_ID })
    expect(p.domainHealth.findMany).toHaveBeenCalledWith({ where: { organizationId: ORG_ID }, orderBy: { domain: 'asc' } })
    expect(p.outboundMessage.findMany.mock.calls[0]![0].where).toMatchObject({ organizationId: ORG_ID })
    expect(p.messageEvent.findMany.mock.calls[0]![0].where).toMatchObject({ organizationId: ORG_ID })
    expect(p.inboundReply.findMany.mock.calls[0]![0].where).toMatchObject({ organizationId: ORG_ID })
    expect(p.outboundMessage.count.mock.calls[0]![0].where).toMatchObject({ organizationId: ORG_ID })
  })

  it('windows sends/bounces/replies to the last ~15 days (14 display days + tz slack)', async () => {
    setup()
    await getDeliverabilityOverview(ORG_ID, NOW)

    const since = new Date(NOW.getTime() - 15 * 86_400_000)
    expect(p.outboundMessage.findMany.mock.calls[0]![0].where.sentAt).toEqual({ gte: since })
    expect(p.messageEvent.findMany.mock.calls[0]![0].where.createdAt).toEqual({ gte: since })
    expect(p.inboundReply.findMany.mock.calls[0]![0].where.receivedAt).toEqual({ gte: since })
  })

  it('bounces query is BOUNCED events only', async () => {
    setup()
    await getDeliverabilityOverview(ORG_ID, NOW)
    expect(p.messageEvent.findMany.mock.calls[0]![0].where.eventType).toBe('BOUNCED')
  })

  it('replies query excludes OUT_OF_OFFICE and requires a mailbox', async () => {
    setup()
    await getDeliverabilityOverview(ORG_ID, NOW)
    const where = p.inboundReply.findMany.mock.calls[0]![0].where
    expect(where.classification).toEqual({ not: 'OUT_OF_OFFICE' })
    expect(where.mailboxId).toEqual({ not: null })
  })

  it('does not filter by provider when the org has no Microsoft tenant', async () => {
    setup({ msTenantId: null })
    await getDeliverabilityOverview(ORG_ID, NOW)
    expect(p.mailbox.findMany.mock.calls[0]![0].where.provider).toBeUndefined()
  })

  it('restricts to Graph mailboxes only for tenant orgs', async () => {
    setup({ msTenantId: 'tenant-1' })
    await getDeliverabilityOverview(ORG_ID, NOW)
    expect(p.mailbox.findMany.mock.calls[0]![0].where.provider).toBe('MICROSOFT_GRAPH')
  })

  it('passes rows through to buildOverview correctly', async () => {
    setup()
    await getDeliverabilityOverview(ORG_ID, NOW)

    expect(buildOverviewMock).toHaveBeenCalledTimes(1)
    const arg = buildOverviewMock.mock.calls[0]![0]
    expect(arg).toMatchObject({
      now: NOW,
      timezone: 'America/New_York',
      mailboxes: [{ id: 'mb-1' }],
      domains: [{ id: 'dh-1' }],
      sends: [{ mailboxId: 'mb-1', sentAt: NOW }],
      bounces: [{ mailboxId: 'mb-1', at: NOW }],
      replies: [{ mailboxId: 'mb-1', at: NOW }],
      queuedNext24h: 3,
    })
  })

  it('drops sends with a null sentAt', async () => {
    setup()
    p.outboundMessage.findMany.mockResolvedValue([{ mailboxId: 'mb-1', sentAt: NOW }, { mailboxId: 'mb-2', sentAt: null }])
    await getDeliverabilityOverview(ORG_ID, NOW)
    const arg = buildOverviewMock.mock.calls[0]![0]
    expect(arg.sends).toEqual([{ mailboxId: 'mb-1', sentAt: NOW }])
  })

  it('returns whatever buildOverview produces', async () => {
    setup()
    const result = await getDeliverabilityOverview(ORG_ID, NOW)
    expect(result).toEqual({ fake: 'overview' })
  })
})
