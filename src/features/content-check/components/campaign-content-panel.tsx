'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ContentRisk, ContentRiskBadge } from './content-risk'
import type { ContentStatusDTO } from '../types'

export function CampaignContentPanel({ campaignId, status }: { campaignId: string; status: ContentStatusDTO }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const flagged = status.items.filter((i) => i.level !== 'LOW')
  const overrideValid = status.override?.valid ?? false

  async function recordOverride() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/content-override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        setError(data?.error ?? 'Could not record the override.')
        return
      }
      setReason('')
      router.refresh()
    } catch {
      setError('Could not record the override.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[var(--text-primary)] font-semibold text-sm">Content check</h2>
        <ContentRiskBadge level={status.level} />
      </div>

      {flagged.length === 0 ? (
        <p className="text-[var(--text-muted)] text-xs">No spam-risk issues found in this campaign&apos;s emails.</p>
      ) : (
        <ul className="space-y-2">
          {flagged.map((item) => (
            <li key={item.key}>
              <ContentRisk level={item.level} findings={item.findings} label={item.label} />
            </li>
          ))}
        </ul>
      )}

      {status.override?.valid && (
        <p className="text-[var(--text-secondary)] text-xs">
          {status.override.at
            ? `Override in effect since ${new Date(status.override.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}: ${status.override.reason}`
            : `Override in effect: ${status.override.reason}`}
        </p>
      )}

      {status.level === 'HIGH' && !overrideValid && (
        <div className="space-y-2">
          <p className="text-[var(--text-secondary)] text-xs">
            Automatic sending is blocked while any email is High risk. Fix the issues above, or record why this wording is intended.
          </p>
          <label className="block text-xs text-[var(--text-secondary)]" htmlFor={`override-${campaignId}`}>
            Override reason
          </label>
          <textarea
            id={`override-${campaignId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm"
          />
          <Button onClick={() => void recordOverride()} disabled={busy || reason.trim().length === 0}>
            Record override
          </Button>
        </div>
      )}

      {error && <p role="alert" className="text-[var(--status-danger)] text-sm">{error}</p>}
    </section>
  )
}
