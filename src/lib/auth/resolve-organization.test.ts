import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    organization: {
      upsert: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { resolveOrganization } from './resolve-organization'

const mockUpsert = prisma.organization.upsert as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('resolveOrganization', () => {
  it('returns an existing organization by clerkId', async () => {
    const existing = { id: 'cuid-1', clerkId: 'org_abc', name: 'Acme', createdAt: new Date(), updatedAt: new Date() }
    mockUpsert.mockResolvedValue(existing)

    const result = await resolveOrganization('org_abc')

    expect(mockUpsert).toHaveBeenCalledWith({
      where: { clerkId: 'org_abc' },
      create: { clerkId: 'org_abc', name: 'org_abc' },
      update: {},
    })
    expect(result).toBe(existing)
  })

  it('creates and returns a new organization when none exists', async () => {
    const created = { id: 'cuid-2', clerkId: 'org_new', name: 'org_new', createdAt: new Date(), updatedAt: new Date() }
    mockUpsert.mockResolvedValue(created)

    const result = await resolveOrganization('org_new')

    expect(result.id).toBe('cuid-2')
    expect(result.clerkId).toBe('org_new')
  })

  it('returns internal id, not the Clerk org id', async () => {
    const org = { id: 'internal-cuid-xyz', clerkId: 'org_clerk123', name: 'org_clerk123', createdAt: new Date(), updatedAt: new Date() }
    mockUpsert.mockResolvedValue(org)

    const result = await resolveOrganization('org_clerk123')

    expect(result.id).toBe('internal-cuid-xyz')
    expect(result.id).not.toBe('org_clerk123')
  })
})
