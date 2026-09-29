import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    lead: { findMany: vi.fn(), update: vi.fn(), createManyAndReturn: vi.fn() },
    importBatch: { create: vi.fn(), update: vi.fn() },
    orgMember: { findMany: vi.fn() },
  },
}))
vi.mock('./connection', () => ({ getConnection: vi.fn() }))
// Keep the real `chunk`/`soqlString` helpers (records.ts uses them for real
// below) and only replace the network-backed client factory with a fake
// object satisfying the SfClient interface.
vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return { ...actual, getSalesforceClient: vi.fn() }
})
// fetchPeople's own Salesforce-row-to-SfPerson mapping is Task 5's job and is
// covered by records.test.ts. Task 8's tests own the paging/classify/merge/
// owner/batch logic downstream of that boundary, so fetchPeople is mocked
// directly with crafted SfPerson objects rather than re-driving it through
// raw SOQL rows via the fake client.
vi.mock('./records', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./records')>()
  return { ...actual, fetchPeople: vi.fn() }
})

import { prisma } from '@/lib/db/prisma'
import { getConnection } from './connection'
import { getSalesforceClient, type SfClient } from './client'
import { fetchPeople, type SfPerson } from './records'
import { normalizeCountry } from '@/features/leads/canada'
import { MAX_SF_IMPORT, importListView, listListViews, previewListView, PREVIEW_ROWS } from './import-list-view'

type Fn = ReturnType<typeof vi.fn>
const p = prisma as unknown as {
  lead: { findMany: Fn; update: Fn; createManyAndReturn: Fn }
  importBatch: { create: Fn; update: Fn }
  orgMember: { findMany: Fn }
}
const mockGetConnection = vi.mocked(getConnection)
const mockGetSalesforceClient = vi.mocked(getSalesforceClient)
const mockFetchPeople = vi.mocked(fetchPeople)

const CONN = {
  id: 'conn-1',
  organizationId: 'org-1',
  status: 'CONNECTED',
  rateLimitedUntil: null,
  customerAccountTypes: ['Customer'],
  blockOpenOpportunities: true,
}

function person(overrides: Partial<SfPerson> = {}): SfPerson {
  return {
    type: 'LEAD',
    id: 'sf-1',
    email: 'a@acme.com',
    firstName: 'Ann',
    lastName: 'Lee',
    company: 'Acme',
    title: 'VP',
    phone: '555-1111',
    state: 'NY',
    country: 'United States',
    postalCode: '14206',
    ownerEmail: null,
    accountId: null,
    accountName: null,
    accountType: null,
    hasOptedOut: false,
    isConverted: false,
    hasOpenOpp: false,
    ...overrides,
  }
}

function fakeClient(overrides: Partial<SfClient> = {}): SfClient {
  return {
    orgId: 'org-1',
    query: vi.fn().mockResolvedValue([]),
    listViews: vi.fn().mockResolvedValue([]),
    listViewIds: vi.fn().mockResolvedValue({ ids: [], size: 0 }),
    create: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockGetConnection.mockResolvedValue(CONN as never)
  p.lead.findMany.mockResolvedValue([])
  p.lead.update.mockResolvedValue({})
  p.lead.createManyAndReturn.mockImplementation(async ({ data }: { data: Record<string, unknown>[] }) => data.map((_, i) => ({ id: `new-${i}` })))
  p.importBatch.create.mockResolvedValue({ id: 'batch-1' })
  p.importBatch.update.mockResolvedValue({})
  p.orgMember.findMany.mockResolvedValue([])
  mockFetchPeople.mockResolvedValue([])
})

describe('importListView — paging', () => {
  it('stops at the list view size (450 rows fetches offsets 0/200/400)', async () => {
    const listViewIds = vi.fn(async (_obj: string, _id: string, { offset }: { limit: number; offset: number }) => {
      if (offset === 0) return { ids: Array.from({ length: 200 }, (_, i) => `id-${i}`), size: 450 }
      if (offset === 200) return { ids: Array.from({ length: 200 }, (_, i) => `id-${200 + i}`), size: 450 }
      if (offset === 400) return { ids: Array.from({ length: 50 }, (_, i) => `id-${400 + i}`), size: 450 }
      throw new Error(`unexpected offset ${offset}`)
    })
    mockGetSalesforceClient.mockReturnValue(fakeClient({ listViewIds }))

    await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    expect(listViewIds).toHaveBeenCalledTimes(3)
    expect(listViewIds.mock.calls.map((c) => c[2].offset)).toEqual([0, 200, 400])
  })

  it('stops at MAX_SF_IMPORT (a size of 5000 fetches offsets 0..1800 only)', async () => {
    const listViewIds = vi.fn(async (_obj: string, _id: string, { offset }: { limit: number; offset: number }) => ({
      ids: Array.from({ length: 200 }, (_, i) => `id-${offset + i}`),
      size: 5000,
    }))
    mockGetSalesforceClient.mockReturnValue(fakeClient({ listViewIds }))

    await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    const offsets = listViewIds.mock.calls.map((c) => c[2].offset)
    expect(offsets).toEqual([0, 200, 400, 600, 800, 1000, 1200, 1400, 1600, 1800])
    expect(offsets.length).toBe(MAX_SF_IMPORT / 200)
  })

  it('stops when a page comes back empty', async () => {
    const listViewIds = vi.fn(async (_obj: string, _id: string, { offset }: { limit: number; offset: number }) => {
      if (offset === 0) return { ids: Array.from({ length: 50 }, (_, i) => `id-${i}`), size: 999 }
      return { ids: [], size: 999 }
    })
    mockGetSalesforceClient.mockReturnValue(fakeClient({ listViewIds }))

    await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    expect(listViewIds).toHaveBeenCalledTimes(2)
  })
})

describe('importListView — mapping new leads', () => {
  it('Lead: customFields, and normalized country', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient({ listViewIds: vi.fn().mockResolvedValue({ ids: ['00Q1'], size: 1 }) }))
    mockFetchPeople.mockResolvedValue([
      person({ type: 'LEAD', id: '00Q1', email: 'lead@acme.com', company: 'Acme Corp', state: 'NY', postalCode: '14206', country: 'United States' }),
    ])

    await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    expect(p.lead.createManyAndReturn).toHaveBeenCalledTimes(1)
    const [{ data }] = p.lead.createManyAndReturn.mock.calls[0]
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      email: 'lead@acme.com',
      company: 'Acme Corp',
      customFields: { state: 'NY', zip: '14206' },
      country: normalizeCountry('United States'),
      source: 'SALESFORCE',
      salesforceId: '00Q1',
      salesforceType: 'LEAD',
      sfCheckStatus: 'CLEAR',
    })
  })

  it('Contact: company comes from the Account name', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient({ listViewIds: vi.fn().mockResolvedValue({ ids: ['0031'], size: 1 }) }))
    mockFetchPeople.mockResolvedValue([
      person({
        type: 'CONTACT', id: '0031', email: 'contact@acme.com', company: 'Acme Inc',
        accountId: 'acc-1', accountName: 'Acme Inc', accountType: 'Prospect',
        state: 'NY', postalCode: '14206', country: 'United States',
      }),
    ])

    await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Contact',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    const [{ data }] = p.lead.createManyAndReturn.mock.calls[0]
    expect(data[0]).toMatchObject({
      company: 'Acme Inc',
      customFields: { state: 'NY', zip: '14206' },
      country: normalizeCountry('United States'),
      salesforceType: 'CONTACT',
      salesforceAccountId: 'acc-1',
    })
  })
})

describe('importListView — skip counting', () => {
  it('counts each blocking/invalid reason once from six crafted people', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([
      person({ id: 's-customer', email: 'customer@acme.com', type: 'CONTACT', accountType: 'Customer' }),
      person({ id: 's-openopp', email: 'openopp@acme.com', type: 'CONTACT', accountType: 'Prospect', hasOpenOpp: true }),
      person({ id: 's-optedout', email: 'optedout@acme.com', hasOptedOut: true }),
      person({ id: 's-converted', email: 'converted@acme.com', type: 'LEAD', isConverted: true }),
      person({ id: 's-noemail', email: null }),
      person({ id: 's-invalid', email: 'not-an-email' }),
    ])

    const result = await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    expect(result.skipped).toEqual({ customer: 1, openOpportunity: 1, optedOut: 1, converted: 1, noEmail: 1, invalid: 1 })
    expect(result.imported).toBe(0)
    expect(result.linked).toBe(0)
    expect(p.lead.createManyAndReturn).not.toHaveBeenCalled()
  })
})

describe('importListView — duplicate email within a list view', () => {
  it('one CUSTOMER Contact and one clear Lead sharing an email: no new lead, counted once as customer', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([
      person({ id: 'sf-contact', email: 'dup@acme.com', type: 'CONTACT', accountType: 'Customer' }),
      person({ id: 'sf-lead', email: 'dup@acme.com', type: 'LEAD' }),
    ])

    const result = await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    expect(result.skipped.customer).toBe(1)
    expect(result.imported).toBe(0)
    expect(p.lead.createManyAndReturn).not.toHaveBeenCalled()
  })

  it('the same pair matching an existing lead: that lead is stamped CUSTOMER and is not counted as linked', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([
      person({ id: 'sf-contact', email: 'dup@acme.com', type: 'CONTACT', accountType: 'Customer' }),
      person({ id: 'sf-lead', email: 'dup@acme.com', type: 'LEAD' }),
    ])
    p.lead.findMany.mockResolvedValue([
      {
        id: 'lead-existing', email: 'dup@acme.com', salesforceId: null,
        firstName: null, lastName: null, company: null, title: null, phone: null, country: null, customFields: null,
      },
    ])

    const result = await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    expect(p.lead.update).toHaveBeenCalledTimes(1)
    const [{ data }] = p.lead.update.mock.calls[0]
    expect(data.sfCheckStatus).toBe('CUSTOMER')
    expect(result.linked).toBe(0)
  })

  it('two clear records sharing an email: exactly one lead is created, linked to the Contact', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    // Contact listed first, Lead second — a last-write-wins bug would pick
    // the Lead instead of the (correct) Contact.
    mockFetchPeople.mockResolvedValue([
      person({ id: 'sf-contact', email: 'dup@acme.com', type: 'CONTACT', accountType: 'Prospect', accountId: 'acc-1', accountName: 'Acme Inc' }),
      person({ id: 'sf-lead', email: 'dup@acme.com', type: 'LEAD' }),
    ])

    const result = await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    expect(p.lead.createManyAndReturn).toHaveBeenCalledTimes(1)
    const [{ data }] = p.lead.createManyAndReturn.mock.calls[0]
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ salesforceType: 'CONTACT', salesforceId: 'sf-contact', salesforceAccountId: 'acc-1' })
    expect(result.imported).toBe(1)
  })
})

describe('importListView — existing leads', () => {
  it('links an existing lead instead of recreating it, filling only null fields, and counts it as linked', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([
      person({ id: 'sf-linked', email: 'linked@acme.com', firstName: 'FromSF', lastName: 'Person', company: 'FromSF Co', state: 'NY', postalCode: '14206' }),
    ])
    p.lead.findMany.mockResolvedValue([
      {
        id: 'lead-existing', email: 'linked@acme.com', salesforceId: null,
        firstName: 'AlreadySet', lastName: null, company: null, title: null, phone: null, country: null, customFields: null,
      },
    ])

    const result = await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    expect(p.lead.createManyAndReturn).not.toHaveBeenCalled()
    expect(p.lead.update).toHaveBeenCalledTimes(1)
    const [{ where, data }] = p.lead.update.mock.calls[0]
    expect(where).toEqual({ id: 'lead-existing' })
    expect(data.firstName).toBeUndefined() // not overwritten
    expect(data.lastName).toBe('Person') // filled from null
    expect(data.salesforceId).toBe('sf-linked') // link set
    expect(data.sfCheckStatus).toBe('CLEAR')
    expect(result.linked).toBe(1)
    expect(result.imported).toBe(0)
  })

  it('does not overwrite the link when a lead is already linked', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([person({ id: 'sf-new', email: 'linked@acme.com' })])
    p.lead.findMany.mockResolvedValue([
      {
        id: 'lead-existing', email: 'linked@acme.com', salesforceId: 'sf-old',
        firstName: null, lastName: null, company: null, title: null, phone: null, country: null, customFields: null,
      },
    ])

    await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    const [{ data }] = p.lead.update.mock.calls[0]
    expect(data.salesforceId).toBeUndefined()
  })

  it('re-import: every email already exists → imported 0, linked n, createManyAndReturn gets no new data', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([
      person({ id: 'sf-1', email: 'one@acme.com' }),
      person({ id: 'sf-2', email: 'two@acme.com' }),
    ])
    p.lead.findMany.mockResolvedValue([
      { id: 'lead-1', email: 'one@acme.com', salesforceId: 'sf-1', firstName: 'A', lastName: 'B', company: null, title: null, phone: null, country: null, customFields: null },
      { id: 'lead-2', email: 'two@acme.com', salesforceId: 'sf-2', firstName: 'C', lastName: 'D', company: null, title: null, phone: null, country: null, customFields: null },
    ])

    const result = await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    expect(result.imported).toBe(0)
    expect(result.linked).toBe(2)
    if (p.lead.createManyAndReturn.mock.calls.length > 0) {
      expect(p.lead.createManyAndReturn.mock.calls[0][0].data).toEqual([])
    }
  })

  it('merges state/zip into customFields only when absent', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([person({ id: 'sf-1', email: 'x@acme.com', state: 'NY', postalCode: '14206' })])
    p.lead.findMany.mockResolvedValue([
      {
        id: 'lead-1', email: 'x@acme.com', salesforceId: null,
        firstName: null, lastName: null, company: null, title: null, phone: null, country: null,
        customFields: { state: 'CA' },
      },
    ])

    await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    const [{ data }] = p.lead.update.mock.calls[0]
    expect(data.customFields).toEqual({ state: 'CA', zip: '14206' })
  })
})

describe('importListView — owners', () => {
  it('defaults ownerId to memberId', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([person({ id: 'sf-1', email: 'x@acme.com', ownerEmail: 'rep@co.com' })])

    await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: false,
    })

    const [{ data }] = p.lead.createManyAndReturn.mock.calls[0]
    expect(data[0].ownerId).toBe('m-1')
    expect(p.orgMember.findMany).not.toHaveBeenCalled()
  })

  it('useSalesforceOwners with a matching Owner.Email assigns that member', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([person({ id: 'sf-1', email: 'x@acme.com', ownerEmail: 'REP@co.com' })])
    p.orgMember.findMany.mockResolvedValue([{ id: 'm-2', email: 'rep@co.com' }])

    await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: true,
    })

    const [{ data }] = p.lead.createManyAndReturn.mock.calls[0]
    expect(data[0].ownerId).toBe('m-2')
  })

  it('useSalesforceOwners with no matching member falls back to memberId', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([person({ id: 'sf-1', email: 'x@acme.com', ownerEmail: 'nobody@elsewhere.com' })])
    p.orgMember.findMany.mockResolvedValue([{ id: 'm-2', email: 'rep@co.com' }])

    await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My List', useSalesforceOwners: true,
    })

    const [{ data }] = p.lead.createManyAndReturn.mock.calls[0]
    expect(data[0].ownerId).toBe('m-1')
  })
})

describe('importListView — batch bookkeeping', () => {
  it('creates the batch with a Salesforce fileName and completes it with the counts', async () => {
    mockGetSalesforceClient.mockReturnValue(fakeClient())
    mockFetchPeople.mockResolvedValue([
      person({ id: 'sf-1', email: 'clear@acme.com' }),
      person({ id: 'sf-2', email: 'blocked@acme.com', hasOptedOut: true }),
    ])

    const result = await importListView({
      organizationId: 'org-1', memberId: 'm-1', object: 'Lead',
      listViewId: 'lv-1', listViewLabel: 'My NY PMs', useSalesforceOwners: false,
    })

    expect(p.importBatch.create).toHaveBeenCalledWith({
      data: { organizationId: 'org-1', fileName: 'Salesforce: My NY PMs', rowCount: 2, status: 'PROCESSING' },
    })
    expect(p.importBatch.update).toHaveBeenCalledWith({
      where: { id: 'batch-1' },
      data: { successCount: 1, errorCount: 1, status: 'COMPLETED' },
    })
    expect(result.batchId).toBe('batch-1')
  })
})

describe('listListViews', () => {
  it('delegates to the client', async () => {
    const listViews = vi.fn().mockResolvedValue([{ id: 'lv1', label: 'My List' }])
    mockGetSalesforceClient.mockReturnValue(fakeClient({ listViews }))
    const result = await listListViews('org-1', 'Contact')
    expect(listViews).toHaveBeenCalledWith('Contact')
    expect(result).toEqual([{ id: 'lv1', label: 'My List' }])
  })
})

describe('previewListView', () => {
  it('returns up to PREVIEW_ROWS rows, ordered by the list view, named firstName lastName or the email', async () => {
    const listViewIds = vi.fn().mockResolvedValue({ ids: ['id-2', 'id-1'], size: 2 })
    mockGetSalesforceClient.mockReturnValue(fakeClient({ listViewIds }))
    mockFetchPeople.mockResolvedValue([
      person({ id: 'id-1', email: 'one@acme.com', firstName: 'Ann', lastName: 'Lee' }),
      person({ id: 'id-2', email: 'two@acme.com', firstName: null, lastName: null }),
    ])

    const result = await previewListView({ organizationId: 'org-1', object: 'Lead', listViewId: 'lv-1' })

    expect(listViewIds).toHaveBeenCalledWith('Lead', 'lv-1', { limit: PREVIEW_ROWS, offset: 0 })
    expect(result.total).toBe(2)
    expect(result.rows).toEqual([
      { id: 'id-2', name: 'two@acme.com', email: 'two@acme.com', company: 'Acme', title: 'VP' },
      { id: 'id-1', name: 'Ann Lee', email: 'one@acme.com', company: 'Acme', title: 'VP' },
    ])
  })
})
