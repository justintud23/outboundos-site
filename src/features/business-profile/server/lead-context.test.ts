import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./profile', () => ({ getBusinessProfile: vi.fn() }))
vi.mock('./zip-distance', () => ({ nearestYard: vi.fn() }))

import { getBusinessProfile } from './profile'
import { nearestYard } from './zip-distance'
import { getLeadContext } from './lead-context'
import type { BusinessProfileDTO } from '../types'

type Fn = ReturnType<typeof vi.fn>
const mockGetProfile = getBusinessProfile as unknown as Fn
const mockNearestYard = nearestYard as unknown as Fn

beforeEach(() => vi.resetAllMocks())

const profile: BusinessProfileDTO = {
  preset: 'snow_paving',
  companySummary: 'We plow commercial lots.',
  services: ['Snow removal'],
  yards: [{ label: 'Buffalo', zip: '14201', radiusMiles: 35 }],
  alwaysZips: [],
  neverZips: [],
  propertyTypes: [],
  decisionTitleKeywords: [],
  downrankTitleKeywords: [],
  bigSites: 5,
  bigAcres: null,
  columnMapping: { zip: 'Postal Code' },
}

describe('getLeadContext', () => {
  it('with no profile: reads facts with the default aliases; profile and distanceMiles are null', async () => {
    mockGetProfile.mockResolvedValue(null)

    const result = await getLeadContext('org-1', { zip: '14206', city: 'Buffalo' })

    expect(result.profile).toBeNull()
    expect(result.distanceMiles).toBeNull()
    expect(result.facts.zip).toBe('14206')
    expect(result.facts.city).toBe('Buffalo')
    expect(mockGetProfile).toHaveBeenCalledWith('org-1')
    expect(mockNearestYard).not.toHaveBeenCalled()
  })

  it('with a profile: uses its columnMapping to read facts and rounds distanceMiles from nearestYard', async () => {
    mockGetProfile.mockResolvedValue(profile)
    mockNearestYard.mockReturnValue({ miles: 12.6, radiusMiles: 35, yard: profile.yards[0] })

    const result = await getLeadContext('org-1', { postal_code: '14206' })

    expect(result.profile).toEqual(profile)
    expect(result.facts.zip).toBe('14206')
    expect(mockNearestYard).toHaveBeenCalledWith('14206', profile.yards)
    expect(result.distanceMiles).toBe(13)
  })

  it('with a profile but no recognized lead ZIP: distanceMiles is null and nearestYard is not called', async () => {
    mockGetProfile.mockResolvedValue(profile)

    const result = await getLeadContext('org-1', {})

    expect(result.distanceMiles).toBeNull()
    expect(mockNearestYard).not.toHaveBeenCalled()
  })
})
