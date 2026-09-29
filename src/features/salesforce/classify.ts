import type { SfPerson } from './server/records'

export type SfStatus = 'CLEAR' | 'CUSTOMER' | 'OPEN_OPPORTUNITY' | 'OPTED_OUT' | 'CONVERTED' | 'NOT_FOUND'
export const BLOCKING: ReadonlySet<SfStatus> = new Set(['OPTED_OUT', 'CONVERTED', 'CUSTOMER', 'OPEN_OPPORTUNITY'])
const RANK: Record<SfStatus, number> = { OPTED_OUT: 5, CONVERTED: 4, CUSTOMER: 3, OPEN_OPPORTUNITY: 2, CLEAR: 1, NOT_FOUND: 0 }
const LABEL: Record<SfStatus, string> = {
  OPTED_OUT: 'opted out', CONVERTED: 'converted lead', CUSTOMER: 'customer',
  OPEN_OPPORTUNITY: 'open opportunity', CLEAR: 'clear', NOT_FOUND: 'not in Salesforce',
}
export const SKIP_KEY: Record<SfStatus, 'optedOut' | 'converted' | 'customer' | 'openOpportunity' | null> = {
  OPTED_OUT: 'optedOut', CONVERTED: 'converted', CUSTOMER: 'customer', OPEN_OPPORTUNITY: 'openOpportunity', CLEAR: null, NOT_FOUND: null,
}

export interface ClassifyRules { customerAccountTypes: string[]; blockOpenOpportunities: boolean }
export interface SfCheck { status: SfStatus; detail: string | null }

export function classifySfRecord(p: SfPerson, rules: ClassifyRules): SfCheck {
  if (p.hasOptedOut) return { status: 'OPTED_OUT', detail: null }
  if (p.type === 'LEAD' && p.isConverted) return { status: 'CONVERTED', detail: p.company }
  const customerTypes = new Set(rules.customerAccountTypes.map((t) => t.trim().toLowerCase()).filter(Boolean))
  if (p.type === 'CONTACT' && p.accountType && customerTypes.has(p.accountType.toLowerCase())) {
    return { status: 'CUSTOMER', detail: p.accountName }
  }
  if (p.type === 'CONTACT' && rules.blockOpenOpportunities && p.hasOpenOpp) {
    return { status: 'OPEN_OPPORTUNITY', detail: p.accountName }
  }
  return { status: 'CLEAR', detail: null }
}

export function mostRestrictive(results: SfCheck[]): SfCheck {
  return results.reduce<SfCheck>((best, r) => (RANK[r.status] > RANK[best.status] ? r : best), { status: 'NOT_FOUND', detail: null })
}

export function blockReason(status: SfStatus, detail: string | null): string {
  return `Salesforce: ${LABEL[status]}${detail ? ` (${detail})` : ''}`
}
