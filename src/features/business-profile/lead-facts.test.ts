import { describe, it, expect } from 'vitest'
import { readLeadFacts, templateLeadWithFacts } from './lead-facts'

describe('readLeadFacts', () => {
  it('reads aliased columns', () => {
    expect(readLeadFacts({ zip_code: '14206', city: 'Buffalo', state: 'NY', property_type: 'HOA', number_of_sites: '12', lot_size: '2.5 ac', customer_status: 'Past customer' })).toEqual({
      zip: '14206', city: 'Buffalo', state: 'NY', propertyType: 'HOA', sites: 12, acres: 2.5, relationship: 'past_customer',
    })
  })

  it('normalizes messy ZIPs (Review Focus #1)', () => {
    expect(readLeadFacts({ zip: '14206-1234' }).zip).toBe('14206')
    expect(readLeadFacts({ postal_code: 2108 }).zip).toBe('02108')
    expect(readLeadFacts({ zip: '501' }).zip).toBe('00501')
    expect(readLeadFacts({ zip: 'n/a' }).zip).toBeNull()
  })

  it('normalizes a 9-digit ZIP+4 with no dash and a dash-form ZIP+4 missing its leading zero (ZIP minor)', () => {
    expect(readLeadFacts({ zip: '142061234' }).zip).toBe('14206')
    expect(readLeadFacts({ zip: '2108-1234' }).zip).toBe('02108')
  })

  it('falls back to a ZIP inside an address column', () => {
    expect(readLeadFacts({ property_address: '123 Main St, Amherst, NY 14221-0001' }).zip).toBe('14221')
  })

  it('column mapping wins over aliases, and mapping values are normalized', () => {
    const facts = readLeadFacts({ type: 'Retail', account_type: 'Office Park' }, { propertyType: 'Account Type' })
    expect(facts.propertyType).toBe('Office Park')
  })

  it('maps relationship text', () => {
    expect(readLeadFacts({ status: 'Closed Lost' }).relationship).toBe('lost_quote')
    expect(readLeadFacts({ relationship: 'quoted 2024' }).relationship).toBe('lost_quote')
    expect(readLeadFacts({ relationship: 'Former client' }).relationship).toBe('past_customer')
    expect(readLeadFacts({ relationship: 'New' }).relationship).toBe('prospect')
    expect(readLeadFacts({}).relationship).toBeNull()
  })

  it('treats unparseable numbers as missing and tolerates non-object input', () => {
    expect(readLeadFacts({ sites: 'many' }).sites).toBeNull()
    expect(readLeadFacts(null)).toEqual({ zip: null, city: null, state: null, propertyType: null, sites: null, acres: null, relationship: null })
  })
})

describe('templateLeadWithFacts', () => {
  it('adds derived merge fields without overriding real columns', () => {
    const lead = { firstName: 'Jo', customFields: { city: 'Real City', property_type: 'HOA' } }
    const out = templateLeadWithFacts(lead, readLeadFacts(lead.customFields))
    expect(out.customFields).toMatchObject({ propertyType: 'HOA', city: 'Real City', property_type: 'HOA' })
    expect(lead.customFields).not.toHaveProperty('propertyType')
  })

  it('adds sites as a string', () => {
    const out = templateLeadWithFacts({ customFields: { sites: '8' } }, readLeadFacts({ sites: '8' }))
    expect((out.customFields as Record<string, unknown>).sites).toBe('8')
  })
})
