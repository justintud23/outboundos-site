import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  graphFetch,
  getGraphToken,
  GraphAuthError,
  GraphThrottledError,
  GraphError,
  __resetGraphTokenCache,
} from './client'

const fetchMock = vi.fn()

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  __resetGraphTokenCache()
  process.env.MS_GRAPH_CLIENT_ID = 'cid'
  process.env.MS_GRAPH_CLIENT_SECRET = 'secret'
})
afterEach(() => vi.unstubAllGlobals())

describe('getGraphToken', () => {
  it('requests a client-credentials token and caches it', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'tok', expires_in: 3600 }))
    expect(await getGraphToken('tenant-1')).toBe('tok')
    expect(await getGraphToken('tenant-1')).toBe('tok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token')
    expect(String((init as RequestInit).body)).toContain('grant_type=client_credentials')
    expect(String((init as RequestInit).body)).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default')
  })
  it('throws GraphAuthError when the token request fails', async () => {
    fetchMock.mockResolvedValueOnce(json(400, { error: 'invalid_client' }))
    await expect(getGraphToken('tenant-1')).rejects.toBeInstanceOf(GraphAuthError)
  })
})

describe('graphFetch', () => {
  beforeEach(() => {
    fetchMock.mockResolvedValueOnce(json(200, { access_token: 'tok', expires_in: 3600 }))
  })

  it('sends bearer auth and the ImmutableId Prefer header, merged with extra prefers', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 'm1' }))
    const out = await graphFetch<{ id: string }>('tenant-1', '/users/a%40b.com/messages', {
      method: 'POST',
      body: { subject: 'x' },
      prefer: ['odata.maxpagesize=50'],
    })
    expect(out).toEqual({ id: 'm1' })
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe('https://graph.microsoft.com/v1.0/users/a%40b.com/messages')
    const headers = (init as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers.Prefer).toBe('IdType="ImmutableId", odata.maxpagesize=50')
    expect(headers['Content-Type']).toBe('application/json')
  })
  it('returns undefined on 202', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }))
    expect(await graphFetch('tenant-1', '/x', { method: 'POST' })).toBeUndefined()
  })
  it('accepts absolute Graph URLs (delta links) but rejects other hosts', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { value: [] }))
    await graphFetch('tenant-1', 'https://graph.microsoft.com/v1.0/users/x/delta?token=1')
    expect(fetchMock.mock.calls[1][0]).toBe('https://graph.microsoft.com/v1.0/users/x/delta?token=1')
    await expect(graphFetch('tenant-1', 'https://evil.example/steal')).rejects.toThrow(/non-Graph URL/)
  })
  it('maps 429 to GraphThrottledError with Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(json(429, { error: { code: 'TooManyRequests', message: 'slow down' } }, { 'retry-after': '17' }))
    const err = await graphFetch('tenant-1', '/x').catch((e) => e)
    expect(err).toBeInstanceOf(GraphThrottledError)
    expect(err.retryAfterSeconds).toBe(17)
  })
  it('maps 403 to GraphAuthError', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: { code: 'ErrorAccessDenied', message: 'no' } }))
    await expect(graphFetch('tenant-1', '/x')).rejects.toBeInstanceOf(GraphAuthError)
  })
  it('maps other failures to GraphError with status and code', async () => {
    fetchMock.mockResolvedValueOnce(json(410, { error: { code: 'SyncStateNotFound', message: 'gone' } }))
    const err = await graphFetch('tenant-1', '/x').catch((e) => e)
    expect(err).toBeInstanceOf(GraphError)
    expect(err.status).toBe(410)
    expect(err.code).toBe('SyncStateNotFound')
  })
})
