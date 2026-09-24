import { Resolver } from 'node:dns/promises'
import type { DomainRecords } from '../evaluate-domain'

// "No such record" answers are real answers; everything else (timeout,
// SERVFAIL, refused) means we couldn't check and must not count as a failure.
const NO_RECORD = new Set(['ENOTFOUND', 'ENODATA'])

export class DnsLookupError extends Error {
  constructor(public readonly code: string, name: string) {
    super(`DNS lookup for ${name} failed (${code})`)
    this.name = 'DnsLookupError'
    Object.setPrototypeOf(this, DnsLookupError.prototype)
  }
}

export interface DnsResolver {
  resolveTxt(name: string): Promise<string[][]>
  resolveMx(name: string): Promise<{ exchange: string; priority: number }[]>
  resolveCname(name: string): Promise<string[]>
}

function defaultResolver(): DnsResolver {
  return new Resolver({ timeout: 5000, tries: 2 })
}

async function orEmpty<T>(name: string, fn: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? 'EUNKNOWN'
    if (NO_RECORD.has(code)) return empty
    throw new DnsLookupError(code, name)
  }
}

export async function lookupDomainRecords(domain: string, resolver: DnsResolver = defaultResolver()): Promise<DomainRecords> {
  const d = domain.toLowerCase()
  const [txt, dmarc, mx, s1, s2] = await Promise.all([
    orEmpty(d, () => resolver.resolveTxt(d), [] as string[][]),
    orEmpty(`_dmarc.${d}`, () => resolver.resolveTxt(`_dmarc.${d}`), [] as string[][]),
    orEmpty(d, () => resolver.resolveMx(d), [] as { exchange: string; priority: number }[]),
    orEmpty(`selector1._domainkey.${d}`, () => resolver.resolveCname(`selector1._domainkey.${d}`), [] as string[]),
    orEmpty(`selector2._domainkey.${d}`, () => resolver.resolveCname(`selector2._domainkey.${d}`), [] as string[]),
  ])
  return {
    txt: txt.map((chunks) => chunks.join('')),
    dmarc: dmarc.map((chunks) => chunks.join('')),
    mx: mx.map((r) => r.exchange.toLowerCase()),
    dkim: { selector1: s1[0] ?? null, selector2: s2[0] ?? null },
  }
}
