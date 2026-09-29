import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    orgMember: { findMany: vi.fn() },
    salesforceConnection: { findUnique: vi.fn() },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { resolveSfUserId, clearOwnerMatchCache } from './owner-match'
import type { SfClient } from './client'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  orgMember: { findMany: Fn }
  salesforceConnection: { findUnique: Fn }
}

function fakeClient(queryImpl: Fn): SfClient {
  return {
    orgId: 'org-1',
    query: queryImpl,
    listViews: vi.fn(),
    listViewIds: vi.fn(),
    create: vi.fn(),
  } as unknown as SfClient
}

beforeEach(() => {
  vi.clearAllMocks()
  clearOwnerMatchCache()
  p.salesforceConnection.findUnique.mockResolvedValue({ sfUserId: '005FALLBACK' })
})

describe('resolveSfUserId', () => {
  it("returns the matching active SF User's Id when the member's email matches", async () => {
    p.orgMember.findMany.mockResolvedValue([{ id: 'mem-1', email: 'jane@acme.com' }])
    const query = vi.fn().mockResolvedValue([{ Id: '005JANE', Email: 'jane@acme.com' }])
    const client = fakeClient(query)

    const result = await resolveSfUserId(client, 'org-1', 'mem-1')

    expect(result).toBe('005JANE')
  })

  it("falls back to the connection's sfUserId when ownerMemberId is null", async () => {
    p.orgMember.findMany.mockResolvedValue([])
    const query = vi.fn().mockResolvedValue([])
    const client = fakeClient(query)

    const result = await resolveSfUserId(client, 'org-1', null)

    expect(result).toBe('005FALLBACK')
    expect(query).not.toHaveBeenCalled()
  })

  it("falls back to the connection's sfUserId when there is no SF User match", async () => {
    p.orgMember.findMany.mockResolvedValue([{ id: 'mem-1', email: 'jane@acme.com' }])
    const query = vi.fn().mockResolvedValue([]) // no active user matches
    const client = fakeClient(query)

    const result = await resolveSfUserId(client, 'org-1', 'mem-1')

    expect(result).toBe('005FALLBACK')
  })

  it('does not query Salesforce again on a second call within an hour (per-org cache)', async () => {
    p.orgMember.findMany.mockResolvedValue([{ id: 'mem-1', email: 'jane@acme.com' }])
    const query = vi.fn().mockResolvedValue([{ Id: '005JANE', Email: 'jane@acme.com' }])
    const client = fakeClient(query)

    await resolveSfUserId(client, 'org-1', 'mem-1')
    await resolveSfUserId(client, 'org-1', 'mem-1')

    expect(query).toHaveBeenCalledTimes(1)
    expect(p.orgMember.findMany).toHaveBeenCalledTimes(1)
  })

  it('compares emails case-insensitively', async () => {
    p.orgMember.findMany.mockResolvedValue([{ id: 'mem-1', email: 'Jane@Acme.com' }])
    const query = vi.fn().mockResolvedValue([{ Id: '005JANE', Email: 'jane@acme.com' }])
    const client = fakeClient(query)

    const result = await resolveSfUserId(client, 'org-1', 'mem-1')

    expect(result).toBe('005JANE')
  })

  it('builds the SOQL with soqlString-escaped emails and IsActive = true', async () => {
    p.orgMember.findMany.mockResolvedValue([{ id: 'mem-1', email: "o'brien@acme.com" }])
    const query = vi.fn().mockResolvedValue([])
    const client = fakeClient(query)

    await resolveSfUserId(client, 'org-1', 'mem-1')

    const soql = query.mock.calls[0]?.[0] as string
    expect(soql).toContain('IsActive = true')
    expect(soql).toContain("'o\\'brien@acme.com'")
  })

  it('filters org members to those with a non-null email', async () => {
    p.orgMember.findMany.mockResolvedValue([])
    const query = vi.fn().mockResolvedValue([])
    const client = fakeClient(query)

    await resolveSfUserId(client, 'org-1', 'mem-1')

    const args = p.orgMember.findMany.mock.calls[0]?.[0]
    expect(args.where.email).toEqual({ not: null })
  })
})
