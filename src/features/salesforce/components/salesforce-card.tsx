'use client'

import { useId, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import type { SalesforceStatusDTO } from '@/features/salesforce/server/settings'
import { loginHostFor } from '@/features/salesforce/config'

interface SalesforceCardProps {
  status: SalesforceStatusDTO
  isAdmin: boolean
}

const STATUS_MESSAGES: Record<string, string> = {
  connected: 'Salesforce connected.',
  connected_new_org:
    'Salesforce connected. This is a different Salesforce org than before, so existing lead links were cleared.',
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: "Salesforce access wasn't approved.",
  not_admin: 'Only an admin can connect Salesforce.',
  state: 'The connection expired. Try again.',
  pkce: 'The connection expired. Try again.',
  not_configured: "Salesforce isn't configured on this server.",
}

function getStatusMessage(searchParams: URLSearchParams): string | null {
  const value = searchParams.get('salesforce')
  if (!value) return null
  if (value === 'error') {
    const reason = searchParams.get('reason')
    return (reason && ERROR_MESSAGES[reason]) || 'Something went wrong connecting to Salesforce.'
  }
  return STATUS_MESSAGES[value] ?? null
}

const JOB_TYPE_LABELS: Record<string, string> = {
  LOG_SEND: 'Email',
  LOG_REPLY: 'Reply',
  CREATE_LEAD: 'New lead',
}

const STATUS_BADGE: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  CONNECTED: { label: 'Connected', variant: 'success' },
  NEEDS_RECONNECT: { label: 'Needs reconnect', variant: 'danger' },
  RATE_LIMITED: { label: 'Rate limited', variant: 'warning' },
}

/** The instance's host (e.g. acme.my.salesforce.com), or null for a missing or malformed URL. */
function hostOf(instanceUrl: string | null): string | null {
  if (!instanceUrl) return null
  try {
    return new URL(instanceUrl).host || null
  } catch {
    return null
  }
}

export function SalesforceCard({ status, isAdmin }: SalesforceCardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const statusMessage = getStatusMessage(searchParams)

  const accountTypesId = useId()
  const instanceHost = hostOf(status.instanceUrl)
  // Reconnect through the same login host the connection was made with, so a
  // sandbox connection isn't sent to the production login page.
  const reconnectEnv = status.loginHost === loginHostFor('sandbox') ? 'sandbox' : 'production'

  const [env, setEnv] = useState<'production' | 'sandbox'>('production')
  const [accountTypesInput, setAccountTypesInput] = useState(status.customerAccountTypes.join(', '))
  const [blockOpenOpportunities, setBlockOpenOpportunities] = useState(status.blockOpenOpportunities)
  const [logActivity, setLogActivity] = useState(status.logActivity)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSaveMessage(null)
    setError(null)

    const customerAccountTypes = accountTypesInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)

    const res = await fetch('/api/integrations/salesforce/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerAccountTypes, blockOpenOpportunities, logActivity }),
    })
    const data = await res.json().catch(() => null)

    setSaving(false)

    if (!res.ok) {
      setError((data as { error?: string } | null)?.error ?? 'Failed to save settings.')
      return
    }

    setSaveMessage('Saved.')
  }

  async function handleDisconnect() {
    if (!window.confirm('Disconnect Salesforce? Syncing stops; records already in Salesforce stay.')) return

    setDisconnecting(true)
    setError(null)

    const res = await fetch('/api/integrations/salesforce', { method: 'DELETE' })

    setDisconnecting(false)

    if (!res.ok) {
      setError('Failed to disconnect Salesforce.')
      return
    }

    router.refresh()
  }

  async function handleRetry(id: string) {
    setRetryingId(id)
    setError(null)

    const res = await fetch(`/api/salesforce/jobs/${id}/retry`, { method: 'POST' })

    setRetryingId(null)

    if (!res.ok) {
      setError('Failed to retry the job.')
      return
    }

    router.refresh()
  }

  if (!status.configured) {
    return (
      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-3 shadow-[var(--shadow-card)]">
        <h2 className="text-[var(--text-primary)] text-sm font-medium">Salesforce</h2>
        <p className="text-[var(--text-muted)] text-xs">Salesforce isn&apos;t configured on this server.</p>
      </div>
    )
  }

  const badge = status.status ? STATUS_BADGE[status.status] : null

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <h2 className="text-[var(--text-primary)] text-sm font-medium">Salesforce</h2>
        {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
      </div>

      {statusMessage && <p className="text-[var(--text-secondary)] text-xs">{statusMessage}</p>}

      {status.status === 'NEEDS_RECONNECT' && (
        <div className="space-y-2 bg-[var(--status-danger-bg)] rounded-[var(--radius-btn)] p-3">
          <p className="text-[var(--status-danger)] text-xs">
            Salesforce needs to be reconnected. Activity logging and customer checks are paused.
          </p>
          {isAdmin && (
            <a href={`/api/integrations/salesforce/connect?env=${reconnectEnv}`}>
              <Button variant="outline" size="sm" as="span">
                Reconnect
              </Button>
            </a>
          )}
        </div>
      )}

      {status.status === 'RATE_LIMITED' && (
        <div className="space-y-2 bg-[var(--status-warning-bg)] rounded-[var(--radius-btn)] p-3">
          <p className="text-[var(--status-warning)] text-xs">
            Salesforce&apos;s daily API limit is nearly used up. Salesforce work resumes at{' '}
            {status.rateLimitedUntil ? new Date(status.rateLimitedUntil).toLocaleString() : 'unknown'}.
          </p>
        </div>
      )}

      {!status.connected ? (
        isAdmin ? (
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="radio"
                  name="salesforce-env"
                  value="production"
                  checked={env === 'production'}
                  onChange={() => setEnv('production')}
                />
                Production
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <input
                  type="radio"
                  name="salesforce-env"
                  value="sandbox"
                  checked={env === 'sandbox'}
                  onChange={() => setEnv('sandbox')}
                />
                Sandbox
              </label>
            </div>
            <a href={`/api/integrations/salesforce/connect?env=${env}`}>
              <Button variant="primary" size="sm" as="span">
                Connect Salesforce
              </Button>
            </a>
            <p className="text-[var(--text-muted)] text-xs">
              Connect with a Salesforce user that has API access. A dedicated integration user works best. If
              you&apos;re not sure, ask your Salesforce admin which edition you have and to allow the OutboundOS
              app.
            </p>
          </div>
        ) : (
          <p className="text-[var(--text-muted)] text-xs">Not connected.</p>
        )
      ) : (
        <div className="space-y-3">
          <p className="text-[var(--text-secondary)] text-sm">
            {`Connected as ${status.username ?? ''}${instanceHost ? ` (${instanceHost})` : ''}`}
          </p>
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={() => void handleDisconnect()} disabled={disconnecting}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          )}
        </div>
      )}

      {isAdmin && status.connected && (
        <div className="space-y-3 border-t border-[var(--border-subtle)] pt-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={accountTypesId} className="text-[var(--text-secondary)] text-xs font-medium">
              Account types that count as customers
            </label>
            <Input
              id={accountTypesId}
              type="text"
              value={accountTypesInput}
              onChange={(e) => setAccountTypesInput(e.target.value)}
              placeholder="Customer"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input
              type="checkbox"
              checked={blockOpenOpportunities}
              onChange={(e) => setBlockOpenOpportunities(e.target.checked)}
            />
            Don&apos;t email contacts whose account has an open opportunity
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={logActivity} onChange={(e) => setLogActivity(e.target.checked)} />
            Log emails and replies to Salesforce
          </label>
          <div className="flex items-center gap-3">
            <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            {saveMessage && <p className="text-[var(--status-success)] text-xs">{saveMessage}</p>}
          </div>
        </div>
      )}

      <div className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
        <p className="text-[var(--text-secondary)] text-xs">
          {`Last 24 hours: ${status.counts.synced24h} synced. ${status.counts.pending} pending, ${status.counts.failed} failed.`}
        </p>
        {isAdmin && status.recentFailures.length > 0 && (
          <div className="space-y-1">
            {status.recentFailures.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="text-[var(--text-primary)] truncate">
                    {JOB_TYPE_LABELS[f.type] ?? f.type} · {f.leadEmail}
                  </p>
                  {f.lastError && <p className="text-[var(--status-danger)] truncate">{f.lastError}</p>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleRetry(f.id)}
                  disabled={retryingId === f.id}
                >
                  {retryingId === f.id ? 'Retrying…' : 'Retry'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[var(--status-danger)] text-xs">
          {error}
        </p>
      )}
    </div>
  )
}
