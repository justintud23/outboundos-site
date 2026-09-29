import { describe, it, expect } from 'vitest'
import type { SfClient } from './client'
import { fetchPeople, lookupByEmails } from './records'
import type { ClassifyRules } from '../classify'

const RULES: ClassifyRules = { customerAccountTypes: ['Customer'], blockOpenOpportunities: true }

/** A fake SfClient that records every SOQL string and returns canned rows by object. */
function fakeClient(handlers: {
  Lead?: (soql: string) => Record<string, unknown>[]
  Contact?: (soql: string) => Record<string, unknown>[]
  Opportunity?: (soql: string) => Record<string, unknown>[]
}): { client: SfClient; queries: string[] } {
  const queries: string[] = []
  const client: SfClient = {
    orgId: 'org-1',
    async query<T>(soql: string): Promise<T[]> {
      queries.push(soql)
      if (soql.includes('FROM Lead')) return (handlers.Lead?.(soql) ?? []) as T[]
      if (soql.includes('FROM Contact')) return (handlers.Contact?.(soql) ?? []) as T[]
      if (soql.includes('FROM Opportunity')) return (handlers.Opportunity?.(soql) ?? []) as T[]
      throw new Error(`unexpected SOQL: ${soql}`)
    },
    async listViews() {
      return []
    },
    async listViewIds() {
      return { ids: [], size: 0 }
    },
    async create() {
      return 'id'
    },
  }
  return { client, queries }
}

describe('fetchPeople - Lead', () => {
  it('selects the Lead fields and builds WHERE Id IN (...) with soqlString', async () => {
    const { client, queries } = fakeClient({
      Lead: () => [
        {
          Id: '00Q1',
          FirstName: 'Jane',
          LastName: 'Doe',
          Email: 'JANE@Acme.com',
          Company: 'Acme',
          Title: 'VP',
          Phone: '555-1000',
          State: 'CA',
          Country: 'US',
          PostalCode: '94107',
          HasOptedOutOfEmail: false,
          IsConverted: false,
          Owner: { Email: 'rep@outboundos.com' },
        },
      ],
    })

    const result = await fetchPeople(client, 'Lead', { ids: ['00Q1'] })

    expect(queries).toEqual([
      "SELECT Id, FirstName, LastName, Email, Company, Title, Phone, State, Country, PostalCode, HasOptedOutOfEmail, IsConverted, Owner.Email FROM Lead WHERE Id IN ('00Q1')",
    ])
    expect(result).toEqual([
      {
        type: 'LEAD',
        id: '00Q1',
        email: 'jane@acme.com',
        firstName: 'Jane',
        lastName: 'Doe',
        company: 'Acme',
        title: 'VP',
        phone: '555-1000',
        state: 'CA',
        country: 'US',
        postalCode: '94107',
        ownerEmail: 'rep@outboundos.com',
        accountId: null,
        accountName: null,
        accountType: null,
        hasOptedOut: false,
        isConverted: false,
        hasOpenOpp: false,
      },
    ])
  })
})

describe('fetchPeople - Contact', () => {
  it('selects the Contact fields, maps company from Account.Name, and sets hasOpenOpp from the Opportunity query', async () => {
    const { client, queries } = fakeClient({
      Contact: () => [
        {
          Id: '003A',
          FirstName: 'Sam',
          LastName: 'Lee',
          Email: 'sam@widget.com',
          Title: 'CTO',
          Phone: '555-2000',
          MailingState: 'NY',
          MailingCountry: 'US',
          MailingPostalCode: '10001',
          HasOptedOutOfEmail: false,
          AccountId: '001A',
          Account: { Name: 'Widget Co', Type: 'Customer' },
          Owner: { Email: 'rep2@outboundos.com' },
        },
      ],
      Opportunity: () => [{ AccountId: '001A' }],
    })

    const result = await fetchPeople(client, 'Contact', { emails: ['sam@widget.com'] })

    expect(queries[0]).toBe(
      "SELECT Id, FirstName, LastName, Email, Title, Phone, MailingState, MailingCountry, MailingPostalCode, HasOptedOutOfEmail, AccountId, Account.Name, Account.Type, Owner.Email FROM Contact WHERE Email IN ('sam@widget.com')",
    )
    expect(queries[1]).toBe("SELECT AccountId FROM Opportunity WHERE IsClosed = false AND AccountId IN ('001A')")
    expect(result).toEqual([
      {
        type: 'CONTACT',
        id: '003A',
        email: 'sam@widget.com',
        firstName: 'Sam',
        lastName: 'Lee',
        company: 'Widget Co',
        title: 'CTO',
        phone: '555-2000',
        state: 'NY',
        country: 'US',
        postalCode: '10001',
        ownerEmail: 'rep2@outboundos.com',
        accountId: '001A',
        accountName: 'Widget Co',
        accountType: 'Customer',
        hasOptedOut: false,
        isConverted: false,
        hasOpenOpp: true,
      },
    ])
  })

  it('skips the Opportunity query when no contact has an AccountId', async () => {
    let opportunityCalled = false
    const { client, queries } = fakeClient({
      Contact: () => [
        {
          Id: '003B',
          FirstName: 'No',
          LastName: 'Account',
          Email: 'no-account@widget.com',
          Title: null,
          Phone: null,
          MailingState: null,
          MailingCountry: null,
          MailingPostalCode: null,
          HasOptedOutOfEmail: false,
          AccountId: null,
          Account: null,
          Owner: null,
        },
      ],
      Opportunity: () => {
        opportunityCalled = true
        return []
      },
    })

    const result = await fetchPeople(client, 'Contact', { emails: ['no-account@widget.com'] })

    expect(opportunityCalled).toBe(false)
    expect(queries).toHaveLength(1)
    expect(result[0]?.hasOpenOpp).toBe(false)
    expect(result[0]?.accountId).toBeNull()
  })

  it('escapes an apostrophe in an email within the SOQL string', async () => {
    const { client, queries } = fakeClient({ Contact: () => [] })
    await fetchPeople(client, 'Contact', { emails: ["o'brien@acme.com"] })
    expect(queries[0]).toContain("'o\\'brien@acme.com'")
  })
})

describe('fetchPeople - chunking', () => {
  it('chunks 450 emails into 3 queries per object (200 + 200 + 50)', async () => {
    const emails = Array.from({ length: 450 }, (_, i) => `person${i}@acme.com`)
    const { client, queries } = fakeClient({ Lead: () => [] })

    await fetchPeople(client, 'Lead', { emails })

    expect(queries).toHaveLength(3)
    expect(queries[0]?.match(/@acme\.com/g)).toHaveLength(200)
    expect(queries[1]?.match(/@acme\.com/g)).toHaveLength(200)
    expect(queries[2]?.match(/@acme\.com/g)).toHaveLength(50)
  })
})

describe('lookupByEmails', () => {
  it('resolves an email found as a CLEAR Contact and a converted Lead to CONVERTED, linked to the Contact', async () => {
    const { client } = fakeClient({
      Contact: () => [
        {
          Id: '003C',
          FirstName: 'Multi',
          LastName: 'Match',
          Email: 'multi@acme.com',
          Title: null,
          Phone: null,
          MailingState: null,
          MailingCountry: null,
          MailingPostalCode: null,
          HasOptedOutOfEmail: false,
          AccountId: null,
          Account: null,
          Owner: null,
        },
      ],
      Lead: () => [
        {
          Id: '00Q2',
          FirstName: 'Multi',
          LastName: 'Match',
          Email: 'multi@acme.com',
          Company: 'Acme',
          Title: null,
          Phone: null,
          State: null,
          Country: null,
          PostalCode: null,
          HasOptedOutOfEmail: false,
          IsConverted: true,
          Owner: null,
        },
      ],
      Opportunity: () => [],
    })

    const result = await lookupByEmails(client, ['multi@acme.com'], RULES)

    const entry = result.get('multi@acme.com')
    expect(entry?.status).toBe('CONVERTED')
    expect(entry?.person?.type).toBe('CONTACT')
    expect(entry?.person?.id).toBe('003C')
  })

  it('returns NOT_FOUND with a null person for an email with no matches', async () => {
    const { client } = fakeClient({ Contact: () => [], Lead: () => [] })

    const result = await lookupByEmails(client, ['nobody@acme.com'], RULES)

    expect(result.get('nobody@acme.com')).toEqual({ status: 'NOT_FOUND', detail: null, person: null })
  })

  it('has a key for every requested email, lower-cased', async () => {
    const { client } = fakeClient({ Contact: () => [], Lead: () => [] })

    const result = await lookupByEmails(client, ['Mixed@Case.com', 'other@acme.com'], RULES)

    expect([...result.keys()].sort()).toEqual(['mixed@case.com', 'other@acme.com'])
  })
})
