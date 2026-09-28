import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { businessProfile: { findUnique: vi.fn(), upsert: vi.fn() } } }))
vi.mock('./zip-distance', () => ({ zipExists: (z: string) => z === '14206' }))

import { prisma } from '@/lib/db/prisma'
import { getBusinessProfile, saveBusinessProfile, ProfileValidationError } from './profile'
import { PRESETS } from '../presets'

type Fn = ReturnType<typeof vi.fn>
const bp = (prisma as unknown as { businessProfile: { findUnique: Fn; upsert: Fn } }).businessProfile
const input = { ...PRESETS.snow_paving, yards: [{ label: 'Buffalo', zip: '14206', radiusMiles: 35 }] }

beforeEach(() => vi.resetAllMocks())

describe('business profile persistence', () => {
  it('returns null when the org has no profile', async () => {
    bp.findUnique.mockResolvedValue(null)
    expect(await getBusinessProfile('org-1')).toBeNull()
    expect(bp.findUnique).toHaveBeenCalledWith({ where: { organizationId: 'org-1' } })
  })

  it('maps a row to the DTO', async () => {
    bp.findUnique.mockResolvedValue({ id: 'bp', organizationId: 'org-1', ...input, createdAt: new Date(), updatedAt: new Date() })
    const dto = await getBusinessProfile('org-1')
    expect(dto).toMatchObject({ preset: 'snow_paving', yards: input.yards, bigSites: 5 })
    expect(dto).not.toHaveProperty('organizationId')
  })

  it('upserts a valid profile scoped to the org', async () => {
    bp.upsert.mockImplementation(async ({ create }: { create: Record<string, unknown> }) => ({ id: 'bp', ...create, createdAt: new Date(), updatedAt: new Date() }))
    await saveBusinessProfile('org-1', input)
    const args = bp.upsert.mock.calls[0]![0]
    expect(args.where).toEqual({ organizationId: 'org-1' })
    expect(args.create.organizationId).toBe('org-1')
    expect(args.update).not.toHaveProperty('organizationId')
  })

  it('throws ProfileValidationError for an unknown yard ZIP', async () => {
    await expect(saveBusinessProfile('org-1', { ...input, yards: [{ zip: '99999', radiusMiles: 10 }] })).rejects.toBeInstanceOf(ProfileValidationError)
    expect(bp.upsert).not.toHaveBeenCalled()
  })
})
