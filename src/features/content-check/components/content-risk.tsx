import { Badge } from '@/components/ui/badge'
import type { Finding, Severity } from '../check-content'

const VARIANT: Record<Severity, 'success' | 'warning' | 'danger'> = { LOW: 'success', MEDIUM: 'warning', HIGH: 'danger' }
const LABEL: Record<Severity, string> = { LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk' }

export function ContentRiskBadge({ level }: { level: Severity }) {
  return <Badge variant={VARIANT[level]} showIcon>{LABEL[level]}</Badge>
}

/** Level badge plus an expandable list of findings with fixes. */
export function ContentRisk({ level, findings, label }: { level: Severity; findings: Finding[]; label?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {label && <span className="text-[var(--text-secondary)] text-sm">{label}</span>}
        <ContentRiskBadge level={level} />
      </div>
      {findings.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-[var(--text-muted)]">
            {findings.length} {findings.length === 1 ? 'issue' : 'issues'}
          </summary>
          <ul className="mt-1 space-y-1">
            {findings.map((f, i) => (
              <li key={`${f.rule}-${i}`} className="text-[var(--text-secondary)]">
                <span className="font-medium">{f.severity.toLowerCase()}:</span> {f.found} — {f.fix}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
