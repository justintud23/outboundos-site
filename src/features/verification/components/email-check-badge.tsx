import type { EmailCheck } from '@prisma/client'
import { Badge } from '@/components/ui/badge'

const LABEL: Record<EmailCheck, string> = {
  UNCHECKED: 'Not checked',
  PENDING: 'Verifying',
  OK: 'Verified',
  RISKY: 'Risky',
  INVALID: 'Invalid',
}

const VARIANT: Record<EmailCheck, 'default' | 'success' | 'warning' | 'danger' | 'muted'> = {
  UNCHECKED: 'muted',
  PENDING: 'default',
  OK: 'success',
  RISKY: 'warning',
  INVALID: 'danger',
}

interface Props {
  check: EmailCheck
  result: string | null
  checkedAt: Date | string | null
}

export function EmailCheckBadge({ check, result, checkedAt }: Props) {
  const date = checkedAt
    ? new Date(checkedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null
  const title = result ? `Verification: ${result}${date ? ` · ${date}` : ''}` : undefined
  return (
    <span title={title}>
      <Badge variant={VARIANT[check]} showIcon aria-label={`Email ${LABEL[check].toLowerCase()}${result ? ` (${result})` : ''}`}>
        {LABEL[check]}
      </Badge>
    </span>
  )
}
