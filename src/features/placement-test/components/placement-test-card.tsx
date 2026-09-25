'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'

interface Props {
  campaignId: string
  sequences: { id: string; name: string }[]
  mailboxes: { id: string; email: string }[]
  leads?: { id: string; label: string }[]
  msConnected: boolean
}

interface PlacementTestResult {
  mailbox: string
  requested: number
  sent: number
  failed: { to: string; error: string }[]
}

// Split on newlines, commas, or any other whitespace, dropping empties.
function splitSeeds(raw: string): string[] {
  return raw
    .split(/[\n,]+|\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function PlacementTestCard({ campaignId, sequences, mailboxes, leads = [], msConnected }: Props) {
  const [sequenceId, setSequenceId] = useState(sequences[0]?.id ?? '')
  const [mailboxId, setMailboxId] = useState(mailboxes[0]?.id ?? '')
  const [leadId, setLeadId] = useState('')
  const [seedsText, setSeedsText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<PlacementTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const seeds = splitSeeds(seedsText)
  const disabled = busy || sequences.length === 0 || mailboxes.length === 0 || seeds.length === 0

  async function handleSend() {
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/placement-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequenceId, mailboxId, leadId: leadId || null, seeds }),
      })
      const data = (await res.json().catch(() => null)) as (PlacementTestResult & { error?: string; code?: string }) | { error?: string } | null
      if (!res.ok) {
        setError((data as { error?: string } | null)?.error ?? 'Could not send the placement test.')
        return
      }
      setResult(data as PlacementTestResult)
    } catch {
      setError('Could not send the placement test.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-3 shadow-[var(--shadow-card)]">
      <div>
        <h2 className="text-[var(--text-primary)] font-semibold text-sm">Placement test</h2>
        <p className="text-[var(--text-muted)] text-xs">
          Get seed addresses free from a placement tester like unspam.email or EmailConsul. Each seed counts toward this mailbox&apos;s daily limit.
        </p>
      </div>

      {!msConnected ? (
        <p className="text-[var(--text-secondary)] text-xs">Connect Microsoft 365 in Settings to send placement tests.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs text-[var(--text-secondary)] space-y-1 block">
              <span className="block">Sequence</span>
              <Select
                className="w-full"
                aria-label="Sequence"
                value={sequenceId}
                onChange={(e) => setSequenceId(e.target.value)}
                disabled={busy}
              >
                {sequences.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            </label>

            <label className="text-xs text-[var(--text-secondary)] space-y-1 block">
              <span className="block">Send from</span>
              <Select
                className="w-full"
                aria-label="Send from"
                value={mailboxId}
                onChange={(e) => setMailboxId(e.target.value)}
                disabled={busy}
              >
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>{m.email}</option>
                ))}
              </Select>
            </label>

            <label className="text-xs text-[var(--text-secondary)] space-y-1 block">
              <span className="block">Sample lead</span>
              <Select
                className="w-full"
                aria-label="Sample lead"
                value={leadId}
                onChange={(e) => setLeadId(e.target.value)}
                disabled={busy}
              >
                <option value="">Built-in sample (Jane at Acme Property Group)</option>
                {leads.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </Select>
            </label>
          </div>

          <label className="text-xs text-[var(--text-secondary)] space-y-1 block">
            <span className="block">Seed addresses</span>
            <textarea
              aria-label="Seed addresses"
              placeholder="One per line, from your placement tester"
              value={seedsText}
              onChange={(e) => setSeedsText(e.target.value)}
              rows={4}
              disabled={busy}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] resize-none"
            />
          </label>

          <Button onClick={() => void handleSend()} disabled={disabled}>
            {busy ? 'Sending…' : 'Send test'}
          </Button>

          {result && (
            <div className="space-y-1">
              <p className="text-[var(--status-success)] text-sm">
                Sent to {result.sent} of {result.requested} seed addresses from {result.mailbox}. Check the results on your tester&apos;s page.
              </p>
              {result.failed.length > 0 && (
                <ul className="text-[var(--text-muted)] text-xs list-disc list-inside">
                  {result.failed.map((f) => (
                    <li key={f.to}>{f.to}: {f.error}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {error && (
            <p role="alert" className="text-[var(--status-danger)] text-sm">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
