// Rules for a Microsoft 365 sending domain. Pure: DNS answers in, verdicts out.
// SPF / DKIM / MX failures block sending; DMARC only warns.

export interface DomainRecords {
  txt: string[] // TXT records on the domain, chunks joined
  dmarc: string[] // TXT records on _dmarc.<domain>
  mx: string[] // MX exchange hostnames
  dkim: { selector1: string | null; selector2: string | null } // CNAME targets
}

export type CheckResult = 'pass' | 'fail' | 'warn' | 'info'

export interface DomainCheck {
  record: 'SPF' | 'DKIM' | 'MX' | 'DMARC'
  result: CheckResult
  found: string | null
  fix: string | null
}

const M365_SPF = 'include:spf.protection.outlook.com'
const M365_DKIM_TARGET = /(\.onmicrosoft\.com|\.dkim\.mail\.microsoft)\.?$/i
const M365_MX = /\.mail\.protection\.outlook\.com\.?$/i

function spfCheck(domain: string, txt: string[]): DomainCheck {
  const spf = txt.filter((t) => /^v=spf1(\s|$)/i.test(t.trim()))
  const add = `Add a TXT record on ${domain}: v=spf1 ${M365_SPF} -all`
  if (spf.length === 0) return { record: 'SPF', result: 'fail', found: null, fix: add }
  if (spf.length > 1) {
    return { record: 'SPF', result: 'fail', found: spf.join(' | '), fix: `Merge your ${spf.length} SPF records into one TXT record (a domain may only have one).` }
  }
  const record = spf[0]!.trim()
  if (!record.toLowerCase().includes(M365_SPF)) {
    return { record: 'SPF', result: 'fail', found: record, fix: `Add "${M365_SPF}" to your SPF record so Microsoft 365 may send for ${domain}.` }
  }
  if (/[+]all\b/i.test(record)) {
    return { record: 'SPF', result: 'fail', found: record, fix: 'Replace "+all" with "-all" — "+all" lets anyone send as your domain.' }
  }
  if (/[-~]all\s*$/i.test(record)) return { record: 'SPF', result: 'pass', found: record, fix: null }
  return { record: 'SPF', result: 'warn', found: record, fix: 'End the SPF record with "-all" (or "~all") instead of "?all" or no "all".' }
}

function dkimCheck(domain: string, dkim: DomainRecords['dkim']): DomainCheck {
  const found = `selector1 → ${dkim.selector1 ?? 'missing'}; selector2 → ${dkim.selector2 ?? 'missing'}`
  const ok = [dkim.selector1, dkim.selector2].every((t) => t !== null && M365_DKIM_TARGET.test(t))
  if (ok) return { record: 'DKIM', result: 'pass', found, fix: null }
  return {
    record: 'DKIM',
    result: 'fail',
    found,
    fix: `In Microsoft Defender → Email & collaboration → Policies → Email authentication settings → DKIM, select ${domain}, add the two CNAME records it shows (selector1._domainkey and selector2._domainkey) to your DNS, then turn on "Sign messages for this domain with DKIM signatures".`,
  }
}

function mxCheck(domain: string, mx: string[]): DomainCheck {
  const fix = `Point ${domain}'s MX record to Microsoft 365 (<your-domain-with-dashes>.mail.protection.outlook.com, priority 0). Microsoft 365 admin center → Settings → Domains → ${domain} shows the exact value.`
  if (mx.length === 0) return { record: 'MX', result: 'fail', found: null, fix }
  const found = mx.join(', ')
  if (mx.every((h) => M365_MX.test(h))) return { record: 'MX', result: 'pass', found, fix: null }
  return { record: 'MX', result: 'fail', found, fix: `${fix} Remove the other MX records — replies sent to them never reach OutboundOS.` }
}

function dmarcCheck(domain: string, dmarc: string[]): DomainCheck {
  const rec = dmarc.find((t) => /^v=DMARC1/i.test(t.trim()))?.trim() ?? null
  if (!rec) {
    return { record: 'DMARC', result: 'warn', found: null, fix: `Add a TXT record on _dmarc.${domain}: v=DMARC1; p=none; rua=mailto:dmarc@${domain}` }
  }
  const policy = /;\s*p=(\w+)/i.exec(rec)?.[1]?.toLowerCase()
  if (policy === 'quarantine' || policy === 'reject') return { record: 'DMARC', result: 'pass', found: rec, fix: null }
  if (policy === 'none') {
    return { record: 'DMARC', result: 'info', found: rec, fix: 'Monitoring only — fine to start. Once reports look clean, change p=none to p=quarantine.' }
  }
  return { record: 'DMARC', result: 'warn', found: rec, fix: 'Your DMARC record has no valid "p=" policy. Use p=none, p=quarantine or p=reject.' }
}

export function evaluateDomain(domain: string, r: DomainRecords): { status: 'HEALTHY' | 'WARNING' | 'FAILING'; checks: DomainCheck[] } {
  const checks = [spfCheck(domain, r.txt), dkimCheck(domain, r.dkim), mxCheck(domain, r.mx), dmarcCheck(domain, r.dmarc)]
  const status = checks.some((c) => c.result === 'fail') ? 'FAILING' : checks.some((c) => c.result === 'warn') ? 'WARNING' : 'HEALTHY'
  return { status, checks }
}
