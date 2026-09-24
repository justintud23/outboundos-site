import { describe, it, expect } from 'vitest'
import { evaluateDomain, type DomainRecords } from './evaluate-domain'

const D = 'getacmesnow.com'
const good: DomainRecords = {
  txt: ['v=spf1 include:spf.protection.outlook.com -all', 'google-site-verification=abc'],
  dmarc: ['v=DMARC1; p=quarantine; rua=mailto:d@getacmesnow.com'],
  mx: ['getacmesnow-com.mail.protection.outlook.com'],
  dkim: {
    selector1: 'selector1-getacmesnow-com._domainkey.acme.onmicrosoft.com',
    selector2: 'selector2-getacmesnow-com._domainkey.acme.onmicrosoft.com',
  },
}
const check = (r: DomainRecords, rec: string) => evaluateDomain(D, r).checks.find((c) => c.record === rec)!

describe('evaluateDomain', () => {
  it('fully configured → HEALTHY', () => {
    const out = evaluateDomain(D, good)
    expect(out.status).toBe('HEALTHY')
    expect(out.checks.map((c) => [c.record, c.result])).toEqual([['SPF', 'pass'], ['DKIM', 'pass'], ['MX', 'pass'], ['DMARC', 'pass']])
  })

  describe('SPF', () => {
    it('missing → fail with the exact record to add', () => {
      const c = check({ ...good, txt: [] }, 'SPF')
      expect(c.result).toBe('fail')
      expect(c.fix).toContain('v=spf1 include:spf.protection.outlook.com -all')
    })
    it('two SPF records → fail', () => {
      expect(check({ ...good, txt: ['v=spf1 -all', 'v=spf1 include:spf.protection.outlook.com -all'] }, 'SPF').result).toBe('fail')
    })
    it('no Microsoft 365 include → fail', () => {
      expect(check({ ...good, txt: ['v=spf1 include:_spf.google.com ~all'] }, 'SPF').result).toBe('fail')
    })
    it('+all → fail; ?all → warn; ~all → pass', () => {
      expect(check({ ...good, txt: ['v=spf1 include:spf.protection.outlook.com +all'] }, 'SPF').result).toBe('fail')
      expect(check({ ...good, txt: ['v=spf1 include:spf.protection.outlook.com ?all'] }, 'SPF').result).toBe('warn')
      expect(check({ ...good, txt: ['v=spf1 include:spf.protection.outlook.com ~all'] }, 'SPF').result).toBe('pass')
    })
  })

  describe('DKIM', () => {
    it('one selector missing → fail', () => {
      expect(check({ ...good, dkim: { ...good.dkim, selector2: null } }, 'DKIM').result).toBe('fail')
    })
    it('pointing somewhere else → fail', () => {
      expect(check({ ...good, dkim: { selector1: 'x.example.net', selector2: 'y.example.net' } }, 'DKIM').result).toBe('fail')
    })
    it('new-style *.dkim.mail.microsoft targets pass', () => {
      expect(check({ ...good, dkim: { selector1: 'a.dkim.mail.microsoft', selector2: 'b.dkim.mail.microsoft.' } }, 'DKIM').result).toBe('pass')
    })
    it('fix mentions enabling DKIM in Defender', () => {
      expect(check({ ...good, dkim: { selector1: null, selector2: null } }, 'DKIM').fix).toMatch(/Defender/)
    })
  })

  describe('MX', () => {
    it('missing → fail', () => expect(check({ ...good, mx: [] }, 'MX').result).toBe('fail'))
    it('any non-Microsoft MX → fail', () => {
      expect(check({ ...good, mx: [...good.mx, 'mx.backup-host.com'] }, 'MX').result).toBe('fail')
    })
    it('trailing dot tolerated', () => expect(check({ ...good, mx: ['x.mail.protection.outlook.com.'] }, 'MX').result).toBe('pass'))
  })

  describe('DMARC never fails', () => {
    it('missing → warn → WARNING status', () => {
      const out = evaluateDomain(D, { ...good, dmarc: [] })
      expect(out.checks.find((c) => c.record === 'DMARC')?.result).toBe('warn')
      expect(out.status).toBe('WARNING')
    })
    it('p=none → info, status stays HEALTHY', () => {
      const out = evaluateDomain(D, { ...good, dmarc: ['v=DMARC1; p=none'] })
      expect(out.checks.find((c) => c.record === 'DMARC')?.result).toBe('info')
      expect(out.status).toBe('HEALTHY')
    })
    it('p=reject → pass', () => expect(check({ ...good, dmarc: ['v=DMARC1; p=reject'] }, 'DMARC').result).toBe('pass'))
  })

  it('any failure → FAILING even if others warn', () => {
    expect(evaluateDomain(D, { ...good, mx: [], dmarc: [] }).status).toBe('FAILING')
  })
})
