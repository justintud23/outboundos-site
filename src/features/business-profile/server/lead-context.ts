import type { BusinessProfileDTO, LeadFacts } from '../types'
import { readLeadFacts } from '../lead-facts'
import { getBusinessProfile } from './profile'
import { nearestYard } from './zip-distance'

/**
 * Combines the org's business profile (if any) with the lead's facts derived
 * from its CSV columns, plus the lead's distance from the nearest yard when
 * both a profile and a recognized ZIP are available. Orgs without a profile
 * still get facts (read with the default column aliases) so derived merge
 * fields ({propertyType}, {city}, {sites}) work either way.
 */
export async function getLeadContext(
  organizationId: string,
  customFields: unknown,
): Promise<{ profile: BusinessProfileDTO | null; facts: LeadFacts; distanceMiles: number | null }> {
  const profile = await getBusinessProfile(organizationId)
  const facts = readLeadFacts(customFields, profile?.columnMapping ?? {})
  const near = profile && facts.zip ? nearestYard(facts.zip, profile.yards) : null
  return { profile, facts, distanceMiles: near ? Math.round(near.miles) : null }
}
