import { describe, it, expect } from 'vitest'
import { canadaExclusionReason, normalizeCountry } from './canada'

const lead = (o: Partial<Parameters<typeof canadaExclusionReason>[0]> = {}) => ({
  email: 'pm@acmeproperty.com',
  phone: null,
  country: null,
  customFields: null,
  ...o,
})

describe('canadaExclusionReason', () => {
  it('returns null for an ordinary US lead', () => {
    expect(canadaExclusionReason(lead({ phone: '(716) 555-0100', customFields: { state: 'NY', city: 'Buffalo' } }))).toBeNull()
  })

  it('flags an explicit Canadian country', () => {
    expect(canadaExclusionReason(lead({ country: 'CA' }))).toBe('country is Canada')
  })

  it.each([
    [{ province: 'Ontario' }],
    [{ province: 'ON' }],
    [{ state: 'QC' }],
    [{ state_province: 'British Columbia' }],
    [{ region: 'Nova Scotia' }],
    [{ state: 'Québec' }],
  ])('flags a Canadian province/territory in %o', (customFields) => {
    expect(canadaExclusionReason(lead({ customFields }))).toMatch(/^province is /)
  })

  it('does not treat province codes as Canadian outside a state/province column', () => {
    expect(canadaExclusionReason(lead({ customFields: { notes: 'ON site visit', city: 'NS' } }))).toBeNull()
  })

  it('flags a .ca email domain but not .com, .cat or .ca inside a longer label', () => {
    expect(canadaExclusionReason(lead({ email: 'jane@propertygroup.ca' }))).toBe('email ends in .ca')
    expect(canadaExclusionReason(lead({ email: 'jane@mail.propertygroup.CA' }))).toBe('email ends in .ca')
    expect(canadaExclusionReason(lead({ email: 'jane@ca-properties.com' }))).toBeNull()
    expect(canadaExclusionReason(lead({ email: 'jane@example.cat' }))).toBeNull()
  })

  it.each(['(416) 555-0199', '+1 604 555 0199', '1-905-555-0199', '519.555.0199'])(
    'flags a Canadian area code in %s',
    (phone) => {
      expect(canadaExclusionReason(lead({ phone }))).toBe(`phone area code ${phone.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '').slice(0, 3)} is Canadian`)
    },
  )

  it.each(['(716) 555-0100', '+1 212 555 0100', '+44 20 7946 0958', '555-0100', ''])(
    'does not flag US, non-NANP or partial numbers: %s',
    (phone) => {
      expect(canadaExclusionReason(lead({ phone }))).toBeNull()
    },
  )

  it('reads country from custom fields too', () => {
    expect(canadaExclusionReason(lead({ customFields: { country: 'Canada' } }))).toBe('country is Canada')
  })
})

describe('normalizeCountry', () => {
  it.each([
    ['Canada', 'CA'], ['ca', 'CA'], ['CAN', 'CA'],
    ['United States', 'US'], ['USA', 'US'], ['us', 'US'], ['U.S.', 'US'],
    ['Mexico', 'Mexico'], ['', null], ['  ', null],
  ])('%s → %s', (input, expected) => {
    expect(normalizeCountry(input)).toBe(expected)
  })
})
