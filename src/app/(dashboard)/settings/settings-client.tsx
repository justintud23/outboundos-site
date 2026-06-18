'use client'

import { useState } from 'react'
import { Mail } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { MailboxDTO } from '@/features/mailboxes/types'

interface SettingsClientProps {
  initialMailboxes: MailboxDTO[]
}

export function SettingsClient({ initialMailboxes }: SettingsClientProps) {
  const [mailboxes, setMailboxes] = useState<MailboxDTO[]>(initialMailboxes)
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await fetch('/api/mailboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, displayName }),
    })
    const data = await res.json().catch(() => null)

    setSaving(false)

    if (!res.ok) {
      setError((data as { error?: string } | null)?.error ?? 'Failed to add mailbox.')
      return
    }

    setMailboxes((prev) => [...prev, data as MailboxDTO])
    setEmail('')
    setDisplayName('')
  }

  async function handleToggleWarmup(mb: MailboxDTO) {
    // Optimistic flip is avoided; just patch and replace with the server's DTO
    // (which recomputes the effective limit / ramp day).
    const res = await fetch(`/api/mailboxes/${mb.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warmupEnabled: !mb.warmupEnabled }),
    })
    if (!res.ok) {
      setError('Failed to update warmup.')
      return
    }
    const updated = (await res.json()) as MailboxDTO
    setMailboxes((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
  }

  async function handleReactivate(mb: MailboxDTO) {
    const res = await fetch(`/api/mailboxes/${mb.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resume: true }),
    })
    if (!res.ok) {
      setError('Failed to reactivate mailbox.')
      return
    }
    const updated = (await res.json()) as MailboxDTO
    setMailboxes((prev) => prev.map((m) => (m.id === updated.id ? updated : m)))
  }

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <h2 className="text-[var(--text-primary)] text-sm font-medium mb-1">Sending mailboxes</h2>
        <p className="text-[var(--text-muted)] text-xs">
          Outbound emails are sent from the active mailbox. Daily limit defaults to 50 emails/day.
          New mailboxes warm up — daily volume ramps gradually to protect sender reputation.
        </p>
      </div>

      {mailboxes.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] divide-y divide-[var(--border-subtle)] shadow-[var(--shadow-card)]">
          {mailboxes.map((mb) => (
            <div key={mb.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <Mail size={14} className="text-[var(--text-muted)] shrink-0" />
                <div>
                  <p className="text-[var(--text-primary)] text-sm">{mb.displayName}</p>
                  <p className="text-[var(--text-muted)] text-xs">{mb.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {mb.autoPaused ? (
                  <span
                    className="text-xs px-2 py-0.5 rounded-[var(--radius-badge)] bg-[var(--status-danger-bg)] text-[var(--status-danger)]"
                    title={mb.pauseReason ?? 'Auto-paused by the bounce/spam circuit breaker'}
                  >
                    Auto-paused
                  </span>
                ) : (
                  <span className={`text-xs px-2 py-0.5 rounded-[var(--radius-badge)] ${mb.isActive ? 'bg-[var(--status-success-bg)] text-[var(--status-success)]' : 'bg-[var(--bg-surface-raised)] text-[var(--text-muted)]'}`}>
                    {mb.isActive ? 'Active' : 'Inactive'}
                  </span>
                )}
                <div className="text-right">
                  {/* Show TODAY's effective (ramped) limit, not the raw dailyLimit. */}
                  <span className="text-[var(--text-muted)] text-xs block">
                    {mb.sentToday}/{mb.effectiveDailyLimit} today
                  </span>
                  {mb.autoPaused ? (
                    <span className="text-[var(--status-danger)] text-[11px] block">
                      paused — {mb.pauseReason ?? 'bounce/spam threshold exceeded'}
                    </span>
                  ) : mb.isWarmingUp ? (
                    <span className="text-[var(--accent-indigo)] text-[11px] block">
                      warming up · day {mb.warmupDay} (cap rises to {mb.dailyLimit})
                    </span>
                  ) : null}
                </div>
                {mb.autoPaused ? (
                  <button
                    type="button"
                    onClick={() => handleReactivate(mb)}
                    className="text-xs px-2 py-0.5 rounded-[var(--radius-badge)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-glow)] transition-colors"
                    title="Clear the auto-pause and resume sending (resets the breaker window)"
                  >
                    Reactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleToggleWarmup(mb)}
                    className="text-xs px-2 py-0.5 rounded-[var(--radius-badge)] border border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-glow)] transition-colors"
                    title={mb.warmupEnabled ? 'Warmup on — disable to send at full daily limit' : 'Warmup off — enable to ramp daily volume'}
                  >
                    Warmup {mb.warmupEnabled ? 'on' : 'off'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-3">
        <h3 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wide">Add mailbox</h3>
        <div className="flex gap-3">
          <Input
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="flex-1"
          />
          <Input
            type="text"
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            className="flex-1"
          />
        </div>
        {error && <p className="text-[var(--status-danger)] text-xs">{error}</p>}
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? 'Adding\u2026' : 'Add mailbox'}
        </Button>
      </form>
    </div>
  )
}
