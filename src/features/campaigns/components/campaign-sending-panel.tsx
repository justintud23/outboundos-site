'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'

interface Props {
  campaignId: string
  autoSend: boolean
  sampleSize: number
  sampleApprovedAt: Date | null
  sampleCount: number
  // Auto-send goes through Microsoft 365: it can't be turned on until the org
  // has connected a tenant (turning it off is always allowed).
  msConnected: boolean
  // CAN-SPAM: sending is blocked until the org has a mailing address.
  hasPostalAddress: boolean
}

export function CampaignSendingPanel({ campaignId, autoSend: initialAutoSend, sampleSize, sampleApprovedAt, sampleCount, msConnected, hasPostalAddress }: Props) {
  const router = useRouter()
  const [autoSend, setAutoSend] = useState(initialAutoSend)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const needsMicrosoft = !msConnected && !autoSend
  const needsAddress = msConnected && !hasPostalAddress && !autoSend
  const blockedHintId = needsMicrosoft ? 'auto-send-needs-microsoft' : needsAddress ? 'auto-send-needs-address' : undefined

  async function toggleAutoSend() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoSend: !autoSend }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? 'Could not update auto-send.')
        return
      }
      setAutoSend(!autoSend)
      router.refresh()
    } catch {
      setError('Could not update auto-send.')
    } finally {
      setBusy(false)
    }
  }

  async function approveSample() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/approve-sample`, { method: 'POST' })
      if (!res.ok) {
        setError('Could not approve the sample.')
        return
      }
      const { queued } = (await res.json()) as { queued: number }
      setMessage(`Sample approved — ${queued} emails queued. New drafts will now send automatically.`)
      router.refresh()
    } catch {
      setError('Could not approve the sample.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[var(--text-primary)] font-semibold text-sm">Automatic sending</h2>
          <p className="text-[var(--text-muted)] text-xs">Drafts are personalized, checked, and sent during business hours without review.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={autoSend}
          aria-label="Send automatically"
          aria-describedby={blockedHintId}
          disabled={busy || needsMicrosoft || needsAddress}
          onClick={() => void toggleAutoSend()}
          className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${autoSend ? 'bg-[var(--accent-indigo)]' : 'bg-[var(--border-default)]'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${autoSend ? 'translate-x-5' : 'translate-x-0.5'}`} />
        </button>
      </div>

      {needsMicrosoft && (
        <p id="auto-send-needs-microsoft" className="text-[var(--text-secondary)] text-xs">
          Connect Microsoft 365 in <Link href="/settings" className="underline">Settings</Link> first.
        </p>
      )}

      {needsAddress && (
        <p id="auto-send-needs-address" className="text-[var(--text-secondary)] text-xs">
          Add your business mailing address in <Link href="/settings" className="underline">Settings</Link> first. US law (CAN-SPAM) requires it in every email.
        </p>
      )}

      {!autoSend && (
        <p className="text-[var(--text-muted)] text-xs">
          Auto-send is off. Emails already queued for this campaign are held — nothing sends until you turn it back on.
        </p>
      )}

      {autoSend && !sampleApprovedAt && (
        <div className="space-y-2">
          <p className="text-[var(--text-secondary)] text-sm">
            {sampleCount} of {sampleSize} sample drafts ready. Review them in Drafts, then approve to start sending.
          </p>
          <Button onClick={() => void approveSample()} disabled={busy || sampleCount === 0}>
            Approve sample &amp; start sending
          </Button>
        </div>
      )}

      {autoSend && sampleApprovedAt && (
        <p className="text-[var(--text-secondary)] text-sm">
          Sending automatically since {new Date(sampleApprovedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
        </p>
      )}

      {message && <p className="text-[var(--status-success)] text-sm">{message}</p>}
      {error && <p role="alert" className="text-[var(--status-danger)] text-sm">{error}</p>}
    </section>
  )
}
