import { describe, it, expect } from 'vitest'
import type { SfPerson } from './server/records'
import { classifySfRecord, mostRestrictive, blockReason, type ClassifyRules } from './classify'

const RULES: ClassifyRules = { customerAccountTypes: ['Customer'], blockOpenOpportunities: true }

function person(overrides: Partial<SfPerson> = {}): SfPerson {
  return {
    type: 'CONTACT',
    id: '003xx',
    email: 'jane@acme.com',
    firstName: 'Jane',
    lastName: 'Doe',
    company: 'Acme',
    title: null,
    phone: null,
    state: null,
    country: null,
    postalCode: null,
    ownerEmail: null,
    accountId: '001xx',
    accountName: 'Acme Property Group',
    accountType: null,
    hasOptedOut: false,
    isConverted: false,
    hasOpenOpp: false,
    ...overrides,
  }
}

describe('classifySfRecord', () => {
  it('opted out wins over customer on the same record', () => {
    const p = person({ hasOptedOut: true, accountType: 'Customer' })
    expect(classifySfRecord(p, RULES)).toEqual({ status: 'OPTED_OUT', detail: null })
  })

  it('classifies a converted Lead as CONVERTED', () => {
    const p = person({ type: 'LEAD', isConverted: true, company: 'Acme' })
    expect(classifySfRecord(p, RULES)).toEqual({ status: 'CONVERTED', detail: 'Acme' })
  })

  it('classifies a Contact with a matching account type as CUSTOMER, case-insensitively, with detail = account name', () => {
    const p = person({ accountType: 'customer', accountName: 'Acme Property Group' })
    expect(classifySfRecord(p, RULES)).toEqual({ status: 'CUSTOMER', detail: 'Acme Property Group' })
  })

  it('classifies a Contact with an open opp as OPEN_OPPORTUNITY when blockOpenOpportunities is true', () => {
    const p = person({ hasOpenOpp: true })
    expect(classifySfRecord(p, RULES)).toEqual({ status: 'OPEN_OPPORTUNITY', detail: 'Acme Property Group' })
  })

  it('classifies a Contact with an open opp as CLEAR when blockOpenOpportunities is false', () => {
    const p = person({ hasOpenOpp: true })
    expect(classifySfRecord(p, { ...RULES, blockOpenOpportunities: false })).toEqual({ status: 'CLEAR', detail: null })
  })

  it('classifies a Lead with none of the flags as CLEAR', () => {
    const p = person({ type: 'LEAD', accountType: null })
    expect(classifySfRecord(p, RULES)).toEqual({ status: 'CLEAR', detail: null })
  })
})

describe('mostRestrictive', () => {
  it('picks the more restrictive of two results', () => {
    expect(
      mostRestrictive([
        { status: 'CLEAR', detail: null },
        { status: 'CONVERTED', detail: 'Acme' },
      ]),
    ).toEqual({ status: 'CONVERTED', detail: 'Acme' })
  })

  it('returns NOT_FOUND for an empty array', () => {
    expect(mostRestrictive([])).toEqual({ status: 'NOT_FOUND', detail: null })
  })
})

describe('blockReason', () => {
  it('includes the detail in parentheses when present', () => {
    expect(blockReason('OPEN_OPPORTUNITY', 'Acme')).toBe('Salesforce: open opportunity (Acme)')
  })

  it('omits the parenthetical when detail is null', () => {
    expect(blockReason('OPTED_OUT', null)).toBe('Salesforce: opted out')
  })
})
