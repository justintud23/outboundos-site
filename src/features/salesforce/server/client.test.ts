import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./connection', () => ({
  getAccessToken: vi.fn(),
  invalidateAccessToken: vi.fn(),
  markNeedsReconnect: vi.fn(),
  markRateLimited: vi.fn(),
}))

import { getAccessToken, invalidateAccessToken, markNeedsReconnect, markRateLimited } from './connection'
import { SalesforceApiError, SalesforceAuthError, SalesforceRateLimitError } from './errors'
import { soqlString, chunk, getSalesforceClient } from './client'

type Fn = ReturnType<typeof vi.fn>
const mockGetAccessToken = getAccessToken as unknown as Fn
const mockInvalidateAccessToken = invalidateAccessToken as unknown as Fn
const mockMarkNeedsReconnect = markNeedsReconnect as unknown as Fn
const mockMarkRateLimited = markRateLimited as unknown as Fn

const INSTANCE_URL = 'https://acme.my.salesforce.com'

function jsonResponse(
  body: unknown,
  opts: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: opts.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAccessToken.mockResolvedValue({ accessToken: 't1', instanceUrl: INSTANCE_URL })
  mockMarkNeedsReconnect.mockResolvedValue(undefined)
  mockMarkRateLimited.mockResolvedValue(undefined)
  global.fetch = vi.fn()
})

describe('soqlString', () => {
  it('escapes a single quote', () => {
    expect(soqlString("o'brien@acme.com")).toBe("'o\\'brien@acme.com'")
  })

  it('doubles a backslash', () => {
    expect(soqlString('a\\b')).toBe("'a\\\\b'")
  })

  it('escapes newlines as \\n', () => {
    expect(soqlString('a\nb')).toBe("'a\\nb'")
  })
})

describe('chunk', () => {
  it('splits an array into chunks of the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('returns an empty array for an empty input', () => {
    expect(chunk([], 5)).toEqual([])
  })

  it('returns a single chunk when size exceeds length', () => {
    expect(chunk([1, 2], 10)).toEqual([[1, 2]])
  })
})

describe('getSalesforceClient / query', () => {
  it('GETs the query endpoint with the encoded SOQL and bearer token', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock.mockResolvedValueOnce(jsonResponse({ records: [], done: true }))

    const client = getSalesforceClient('org-1')
    await client.query('SELECT Id FROM Lead')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${INSTANCE_URL}/services/data/v62.0/query?q=${encodeURIComponent('SELECT Id FROM Lead')}`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t1')
  })

  it('follows nextRecordsUrl until done: true, concatenating records', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          records: [{ attributes: { type: 'Lead' }, Id: '1' }],
          done: false,
          nextRecordsUrl: '/services/data/v62.0/query/01g-2000',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ records: [{ attributes: { type: 'Lead' }, Id: '2' }], done: true }),
      )

    const client = getSalesforceClient('org-1')
    const result = await client.query<{ Id: string }>('SELECT Id FROM Lead')

    expect(result).toEqual([{ Id: '1' }, { Id: '2' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${INSTANCE_URL}/services/data/v62.0/query/01g-2000`)
  })

  it('strips the attributes key from records', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ records: [{ attributes: { type: 'Lead', url: '/x' }, Id: '1', Name: 'A' }], done: true }),
    )

    const client = getSalesforceClient('org-1')
    const result = await client.query('SELECT Id, Name FROM Lead')

    expect(result).toEqual([{ Id: '1', Name: 'A' }])
  })
})

describe('retry on 401', () => {
  it('invalidates the token and retries once on a single 401', async () => {
    const fetchMock = global.fetch as Fn
    mockGetAccessToken
      .mockResolvedValueOnce({ accessToken: 't1', instanceUrl: INSTANCE_URL })
      .mockResolvedValueOnce({ accessToken: 't2', instanceUrl: INSTANCE_URL })
    fetchMock
      .mockResolvedValueOnce(jsonResponse([{ message: 'Session expired or invalid', errorCode: 'INVALID_SESSION_ID' }], { status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ records: [], done: true }))

    const client = getSalesforceClient('org-1')
    await client.query('SELECT Id FROM Lead')

    expect(mockInvalidateAccessToken).toHaveBeenCalledTimes(1)
    expect(mockInvalidateAccessToken).toHaveBeenCalledWith('org-1')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit
    expect((secondInit.headers as Record<string, string>).Authorization).toBe('Bearer t2')
    expect(mockMarkNeedsReconnect).not.toHaveBeenCalled()
  })

  it('marks needs-reconnect and throws SalesforceAuthError on a second 401', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock.mockResolvedValue(jsonResponse([{ message: 'Session expired or invalid', errorCode: 'INVALID_SESSION_ID' }], { status: 401 }))

    const client = getSalesforceClient('org-1')
    await expect(client.query('SELECT Id FROM Lead')).rejects.toBeInstanceOf(SalesforceAuthError)

    expect(mockInvalidateAccessToken).toHaveBeenCalledTimes(2)
    expect(mockMarkNeedsReconnect).toHaveBeenCalledTimes(1)
    expect(mockMarkNeedsReconnect).toHaveBeenCalledWith('org-1', expect.any(String))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('error mapping', () => {
  it('maps a 403 REQUEST_LIMIT_EXCEEDED to SalesforceRateLimitError and marks rate limited', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ errorCode: 'REQUEST_LIMIT_EXCEEDED', message: 'TotalRequests Limit exceeded.' }], { status: 403 }),
    )

    const client = getSalesforceClient('org-1')
    await expect(client.query('SELECT Id FROM Lead')).rejects.toBeInstanceOf(SalesforceRateLimitError)
    expect(mockMarkRateLimited).toHaveBeenCalledTimes(1)
    expect(mockMarkRateLimited.mock.calls[0]?.[0]).toBe('org-1')
    expect(mockMarkRateLimited.mock.calls[0]?.[1]).toBeInstanceOf(Date)
  })

  it('maps a 400 with a Salesforce error body to SalesforceApiError with errorCode and message', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock.mockResolvedValueOnce(
      jsonResponse([{ errorCode: 'REQUIRED_FIELD_MISSING', message: 'Required fields are missing: [Industry]' }], { status: 400 }),
    )

    const client = getSalesforceClient('org-1')
    let caught: unknown
    try {
      await client.query('SELECT Id FROM Lead')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(SalesforceApiError)
    const err = caught as SalesforceApiError
    expect(err.errorCode).toBe('REQUIRED_FIELD_MISSING')
    expect(err.message).toBe('Required fields are missing: [Industry]')
  })
})

describe('usage header', () => {
  it('marks rate limited when Sforce-Limit-Info crosses the 80% threshold', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ records: [], done: true }, { headers: { 'Sforce-Limit-Info': 'api-usage=80/100' } }),
    )

    const client = getSalesforceClient('org-1')
    await client.query('SELECT Id FROM Lead')

    expect(mockMarkRateLimited).toHaveBeenCalledTimes(1)
    expect(mockMarkRateLimited.mock.calls[0]?.[0]).toBe('org-1')
  })

  it('does not mark rate limited when usage is below the threshold', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ records: [], done: true }, { headers: { 'Sforce-Limit-Info': 'api-usage=79/100' } }),
    )

    const client = getSalesforceClient('org-1')
    await client.query('SELECT Id FROM Lead')

    expect(mockMarkRateLimited).not.toHaveBeenCalled()
  })
})

describe('listViews', () => {
  it('follows nextRecordsUrl and returns {id, label}', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          listviews: [{ id: 'lv1', label: 'My Leads' }],
          done: false,
          nextRecordsUrl: '/services/data/v62.0/sobjects/Lead/listviews?pageToken=2',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ listviews: [{ id: 'lv2', label: 'All Open Leads' }], done: true }),
      )

    const client = getSalesforceClient('org-1')
    const views = await client.listViews('Lead')

    expect(views).toEqual([
      { id: 'lv1', label: 'My Leads' },
      { id: 'lv2', label: 'All Open Leads' },
    ])
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${INSTANCE_URL}/services/data/v62.0/sobjects/Lead/listviews`)
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${INSTANCE_URL}/services/data/v62.0/sobjects/Lead/listviews?pageToken=2`)
  })
})

describe('listViewIds', () => {
  it('GETs the listview results endpoint and extracts Id column values and size', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        size: 2,
        records: [
          { columns: [{ fieldNameOrPath: 'Id', value: '00Q1' }, { fieldNameOrPath: 'Name', value: 'Jane' }] },
          { columns: [{ fieldNameOrPath: 'Name', value: 'No Id Here' }, { fieldNameOrPath: 'Id', value: '00Q2' }] },
        ],
      }),
    )

    const client = getSalesforceClient('org-1')
    const result = await client.listViewIds('Lead', 'lv1', { limit: 200, offset: 0 })

    expect(result).toEqual({ ids: ['00Q1', '00Q2'], size: 2 })
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      `${INSTANCE_URL}/services/data/v62.0/sobjects/Lead/listviews/lv1/results?limit=200&offset=0`,
    )
  })
})

describe('create', () => {
  it('POSTs JSON to the sobject endpoint and returns the new id', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: '00T1', success: true, errors: [] }))

    const client = getSalesforceClient('org-1')
    const id = await client.create('Task', { Subject: 'Follow up', WhoId: '00Q1' })

    expect(id).toBe('00T1')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${INSTANCE_URL}/services/data/v62.0/sobjects/Task/`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ Subject: 'Follow up', WhoId: '00Q1' })
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('throws SalesforceApiError when success is false', async () => {
    const fetchMock = global.fetch as Fn
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: false, errors: [{ statusCode: 'REQUIRED_FIELD_MISSING', message: 'Required fields are missing: [WhoId]' }] }),
    )

    const client = getSalesforceClient('org-1')
    await expect(client.create('Task', { Subject: 'Follow up' })).rejects.toBeInstanceOf(SalesforceApiError)
  })
})
