import { describe, it, expect, vi } from 'vitest'
import { lookupDomainRecords, DnsLookupError, type DnsResolver } from './lookup-domain'

const err = (code: string) => Object.assign(new Error(code), { code })

function resolver(over: Partial<DnsResolver> = {}): DnsResolver {
  return {
    resolveTxt: vi.fn(async (n: string) =>
      n.startsWith('_dmarc.') ? [['v=DMARC1; ', 'p=none']] : [['v=spf1 include:spf.protection.outlook.com', ' -all']]),
    resolveMx: vi.fn(async () => [{ exchange: 'X.mail.protection.outlook.com', priority: 0 }]),
    resolveCname: vi.fn(async (n: string) => [`${n.split('.')[0]}.acme.onmicrosoft.com`]),
    ...over,
  }
}

describe('lookupDomainRecords', () => {
  it('joins TXT chunks, lower-cases MX, reads both DKIM selectors', async () => {
    const r = await lookupDomainRecords('acme.com', resolver())
    expect(r).toEqual({
      txt: ['v=spf1 include:spf.protection.outlook.com -all'],
      dmarc: ['v=DMARC1; p=none'],
      mx: ['x.mail.protection.outlook.com'],
      dkim: { selector1: 'selector1.acme.onmicrosoft.com', selector2: 'selector2.acme.onmicrosoft.com' },
    })
  })
  it('ENOTFOUND / ENODATA mean "no record", not an error', async () => {
    const r = await lookupDomainRecords('acme.com', resolver({
      resolveMx: vi.fn(async () => { throw err('ENODATA') }),
      resolveCname: vi.fn(async () => { throw err('ENOTFOUND') }),
    }))
    expect(r.mx).toEqual([])
    expect(r.dkim).toEqual({ selector1: null, selector2: null })
  })
  it('timeouts / SERVFAIL throw DnsLookupError (couldn\'t check)', async () => {
    await expect(lookupDomainRecords('acme.com', resolver({ resolveTxt: vi.fn(async () => { throw err('ETIMEOUT') }) })))
      .rejects.toBeInstanceOf(DnsLookupError)
  })
})
