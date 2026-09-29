'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { relativeTime } from '@/lib/format'
import { BLOCKING, blockReason } from '../classify'
import type { SfCheckStatus } from '@prisma/client'
import type { LeadSalesforceDTO } from '@/features/leads/types'

const STATUS_LABEL: Record<SfCheckStatus, string> = {
  CLEAR: 'clear',
  NOT_FOUND: 'not in Salesforce',
  OPTED_OUT: 'opted out',
  CONVERTED: 'converted lead',
  CUSTOMER: 'customer',
  OPEN_OPPORTUNITY: 'open opportunity',
}

interface SalesforceBadgeProps {
  instanceUrl: string
  leadId: string
  salesforce: LeadSalesforceDTO
  isAdmin: boolean
}

export function SalesforceBadge({ instanceUrl, leadId, salesforce, isAdmin }: SalesforceBadgeProps) {
  const router = useRouter()
  const [allowing, setAllowing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { id, checkStatus, checkDetail, checkedAt, blockOverride } = salesforce

  const blockingStatus: SfCheckStatus | null =
    checkStatus !== null && BLOCKING.has(checkStatus) ? checkStatus : null

  async function handleAllowAnyway() {
    setAllowing(true)
    setError(null)
    try {
      const res = await fetch(`/api/leads/${leadId}/salesforce-override`, { method: 'POST' })
      if (!res.ok) {
        setError('Could not allow this lead.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not allow this lead.')
    } finally {
      setAllowing(false)
    }
  }

  return (
    <div className="space-y-1 text-xs">
      {id && (
        <a
          href={`${instanceUrl}/${id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--accent-indigo)] hover:underline"
        >
          View in Salesforce
        </a>
      )}

      <p className="text-[var(--text-muted)]">
        {checkStatus === null
          ? 'Salesforce check: not checked yet'
          : `Salesforce check: ${STATUS_LABEL[checkStatus]}${
              checkedAt ? ` (checked ${relativeTime(new Date(checkedAt))})` : ''
            }`}
      </p>

      {blockingStatus && !blockOverride && (
        <div className="space-y-1">
          <p className="text-[var(--status-danger)]">
            {blockReason(blockingStatus, checkDetail)} Emails to this lead are blocked.
          </p>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => void handleAllowAnyway()} disabled={allowing}>
              {allowing ? 'Allowing…' : 'Allow anyway'}
            </Button>
          )}
        </div>
      )}

      {blockOverride && (
        <p className="text-[var(--text-muted)]">
          Allowed by an admin despite Salesforce. Re-enroll the lead to resume emailing.
        </p>
      )}

      {error && (
        <p role="alert" className="text-[var(--status-danger)]">
          {error}
        </p>
      )}
    </div>
  )
}
