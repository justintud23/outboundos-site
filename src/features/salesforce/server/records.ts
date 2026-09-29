import { chunk, soqlString, type SfClient } from './client'
import { classifySfRecord, mostRestrictive, type ClassifyRules, type SfStatus } from '../classify'

export interface SfPerson {
  type: 'LEAD' | 'CONTACT'; id: string; email: string | null
  firstName: string | null; lastName: string | null; company: string | null; title: string | null; phone: string | null
  state: string | null; country: string | null; postalCode: string | null; ownerEmail: string | null
  accountId: string | null; accountName: string | null; accountType: string | null
  hasOptedOut: boolean; isConverted: boolean; hasOpenOpp: boolean
}

const LEAD_FIELDS = 'Id, FirstName, LastName, Email, Company, Title, Phone, State, Country, PostalCode, HasOptedOutOfEmail, IsConverted, Owner.Email'
const CONTACT_FIELDS = 'Id, FirstName, LastName, Email, Title, Phone, MailingState, MailingCountry, MailingPostalCode, HasOptedOutOfEmail, AccountId, Account.Name, Account.Type, Owner.Email'

type Row = Record<string, unknown>
const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const rel = (r: Row, k: string): Row | null => (r[k] && typeof r[k] === 'object' ? (r[k] as Row) : null)

export async function fetchPeople(client: SfClient, object: 'Lead' | 'Contact', by: { ids: string[] } | { emails: string[] }): Promise<SfPerson[]> {
  const field = 'ids' in by ? 'Id' : 'Email'
  const values = [...new Set('ids' in by ? by.ids : by.emails.map((e) => e.toLowerCase()))]
  const rows: Row[] = []
  for (const part of chunk(values, 200)) {
    const fields = object === 'Lead' ? LEAD_FIELDS : CONTACT_FIELDS
    rows.push(...(await client.query<Row>(`SELECT ${fields} FROM ${object} WHERE ${field} IN (${part.map(soqlString).join(', ')})`)))
  }

  if (object === 'Lead') {
    return rows.map((r) => ({
      type: 'LEAD', id: String(r.Id), email: s(r.Email)?.toLowerCase() ?? null,
      firstName: s(r.FirstName), lastName: s(r.LastName), company: s(r.Company), title: s(r.Title), phone: s(r.Phone),
      state: s(r.State), country: s(r.Country), postalCode: s(r.PostalCode), ownerEmail: s(rel(r, 'Owner')?.Email),
      accountId: null, accountName: null, accountType: null,
      hasOptedOut: r.HasOptedOutOfEmail === true, isConverted: r.IsConverted === true, hasOpenOpp: false,
    }))
  }

  const accountIds = [...new Set(rows.map((r) => s(r.AccountId)).filter((v): v is string => !!v))]
  const withOpenOpp = new Set<string>()
  for (const part of chunk(accountIds, 200)) {
    const opps = await client.query<{ AccountId: string }>(
      `SELECT AccountId FROM Opportunity WHERE IsClosed = false AND AccountId IN (${part.map(soqlString).join(', ')})`,
    )
    for (const o of opps) withOpenOpp.add(o.AccountId)
  }
  return rows.map((r) => {
    const account = rel(r, 'Account')
    const accountId = s(r.AccountId)
    return {
      type: 'CONTACT', id: String(r.Id), email: s(r.Email)?.toLowerCase() ?? null,
      firstName: s(r.FirstName), lastName: s(r.LastName), company: s(account?.Name), title: s(r.Title), phone: s(r.Phone),
      state: s(r.MailingState), country: s(r.MailingCountry), postalCode: s(r.MailingPostalCode), ownerEmail: s(rel(r, 'Owner')?.Email),
      accountId, accountName: s(account?.Name), accountType: s(account?.Type),
      hasOptedOut: r.HasOptedOutOfEmail === true, isConverted: false, hasOpenOpp: !!accountId && withOpenOpp.has(accountId),
    }
  })
}

export async function lookupByEmails(client: SfClient, emails: string[], rules: ClassifyRules) {
  const keys = [...new Set(emails.map((e) => e.toLowerCase()))]
  const people = [...(await fetchPeople(client, 'Contact', { emails: keys })), ...(await fetchPeople(client, 'Lead', { emails: keys }))]
  const out = new Map<string, { status: SfStatus; detail: string | null; person: SfPerson | null }>()
  for (const email of keys) {
    const matches = people.filter((p) => p.email === email)
    const check = mostRestrictive(matches.map((p) => classifySfRecord(p, rules)))
    const person = matches.find((p) => p.type === 'CONTACT') ?? matches.find((p) => p.type === 'LEAD' && !p.isConverted) ?? null
    out.set(email, { ...check, person })
  }
  return out
}
