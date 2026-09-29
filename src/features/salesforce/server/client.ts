import { SF_API_VERSION } from '../config'
import { getAccessToken, invalidateAccessToken, markNeedsReconnect, markRateLimited } from './connection'
import { SalesforceApiError, SalesforceAuthError, SalesforceRateLimitError } from './errors'

const RATE_LIMIT_THRESHOLD = 0.8

export function soqlString(v: string): string {
  const escaped = v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')
  return `'${escaped}'`
}

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size))
  return out
}

function nextUtcMidnight(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
}

export interface SfClient {
  orgId: string
  query<T>(soql: string): Promise<T[]>
  listViews(sobject: 'Lead' | 'Contact'): Promise<{ id: string; label: string }[]>
  listViewIds(
    sobject: 'Lead' | 'Contact',
    listViewId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ ids: string[]; size: number }>
  create(sobject: string, fields: Record<string, unknown>): Promise<string>
}

function stripAttributes<T>(r: Record<string, unknown>): T {
  const { attributes: _a, ...rest } = r
  for (const [k, v] of Object.entries(rest)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && 'attributes' in (v as object)) {
      rest[k] = stripAttributes(v as Record<string, unknown>)
    }
  }
  return rest as T
}

export function getSalesforceClient(orgId: string): SfClient {
  async function request(path: string, init: RequestInit = {}, retried = false): Promise<unknown> {
    const { accessToken, instanceUrl } = await getAccessToken(orgId)
    const url = path.startsWith('http') ? path : `${instanceUrl}${path}`
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })

    const usage = res.headers.get('Sforce-Limit-Info')?.match(/api-usage=(\d+)\/(\d+)/)
    if (usage && Number(usage[2]) > 0 && Number(usage[1]) / Number(usage[2]) >= RATE_LIMIT_THRESHOLD) {
      await markRateLimited(orgId, nextUtcMidnight())
    }

    if (res.status === 401) {
      invalidateAccessToken(orgId)
      if (!retried) return request(path, init, true)
      await markNeedsReconnect(orgId, 'Salesforce rejected the access token')
      throw new SalesforceAuthError()
    }

    const data = (await res.json().catch(() => null)) as unknown
    if (!res.ok) {
      const first = Array.isArray(data) ? (data[0] as { errorCode?: string; message?: string } | undefined) : undefined
      const errorCode = first?.errorCode ?? `HTTP_${res.status}`
      if (errorCode === 'REQUEST_LIMIT_EXCEEDED') {
        await markRateLimited(orgId, nextUtcMidnight())
        throw new SalesforceRateLimitError()
      }
      throw new SalesforceApiError(res.status, errorCode, first?.message ?? `Salesforce request failed (${res.status})`)
    }
    return data
  }

  const base = `/services/data/${SF_API_VERSION}`

  return {
    orgId,
    async query<T>(soql: string): Promise<T[]> {
      const out: T[] = []
      let page = (await request(`${base}/query?q=${encodeURIComponent(soql)}`)) as {
        records: Record<string, unknown>[]
        done: boolean
        nextRecordsUrl?: string
      }
      out.push(...page.records.map((r) => stripAttributes<T>(r)))
      while (!page.done && page.nextRecordsUrl) {
        page = (await request(page.nextRecordsUrl)) as typeof page
        out.push(...page.records.map((r) => stripAttributes<T>(r)))
      }
      return out
    },
    async listViews(sobject) {
      const out: { id: string; label: string }[] = []
      let page = (await request(`${base}/sobjects/${sobject}/listviews`)) as {
        listviews: { id: string; label: string }[]
        done?: boolean
        nextRecordsUrl?: string | null
      }
      out.push(...page.listviews.map((v) => ({ id: v.id, label: v.label })))
      while (page.done === false && page.nextRecordsUrl) {
        page = (await request(page.nextRecordsUrl)) as typeof page
        out.push(...page.listviews.map((v) => ({ id: v.id, label: v.label })))
      }
      return out
    },
    async listViewIds(sobject, listViewId, { limit, offset }) {
      const data = (await request(
        `${base}/sobjects/${sobject}/listviews/${encodeURIComponent(listViewId)}/results?limit=${limit}&offset=${offset}`,
      )) as { size: number; records: { columns: { fieldNameOrPath: string; value: string | null }[] }[] }
      const ids = data.records
        .map((r) => r.columns.find((c) => c.fieldNameOrPath === 'Id')?.value)
        .filter((v): v is string => !!v)
      return { ids, size: data.size }
    },
    async create(sobject, fields) {
      const data = (await request(`${base}/sobjects/${sobject}/`, {
        method: 'POST',
        body: JSON.stringify(fields),
      })) as { id?: string; success?: boolean; errors?: { statusCode?: string; message?: string }[] }
      if (!data.success || !data.id) {
        const e = data.errors?.[0]
        throw new SalesforceApiError(400, e?.statusCode ?? 'CREATE_FAILED', e?.message ?? `Could not create ${sobject}`)
      }
      return data.id
    },
  }
}
