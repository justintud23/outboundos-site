'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import type { SendingSettingsDTO } from '@/features/settings/server/sending-settings'

interface SendingSettingsFormProps {
  initial: SendingSettingsDTO
}

const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (New York)' },
  { value: 'America/Chicago', label: 'Central (Chicago)' },
  { value: 'America/Denver', label: 'Mountain (Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (Los Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Honolulu)' },
]

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function listToText(list: string[]): string {
  return list.join('\n')
}

function textToList(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

async function patchSettings(patch: Record<string, unknown>): Promise<{ ok: true; data: SendingSettingsDTO } | { ok: false; error: string }> {
  const res = await fetch('/api/settings/sending', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const data = await res.json().catch(() => null)

  if (!res.ok) {
    return { ok: false, error: (data as { error?: string } | null)?.error ?? 'Failed to save settings.' }
  }
  return { ok: true, data: data as SendingSettingsDTO }
}

export function SendingSettingsForm({ initial }: SendingSettingsFormProps) {
  const [settings, setSettings] = useState<SendingSettingsDTO>(initial)
  const [escalationEmail, setEscalationEmail] = useState(initial.escalationEmail ?? '')
  const [timezone, setTimezone] = useState(initial.timezone)
  const [businessHoursStart, setBusinessHoursStart] = useState(initial.businessHoursStart)
  const [businessHoursEnd, setBusinessHoursEnd] = useState(initial.businessHoursEnd)
  const [sendDays, setSendDays] = useState<Set<number>>(new Set(initial.sendDays))
  const [blockedPhrases, setBlockedPhrases] = useState(listToText(initial.guardrailBlockedPhrases))
  const [allowedWords, setAllowedWords] = useState(listToText(initial.guardrailAllowedWords))
  const [businessName, setBusinessName] = useState(initial.businessName ?? '')
  const [postalAddress, setPostalAddress] = useState(initial.postalAddress ?? '')
  const [allowCanadian, setAllowCanadian] = useState(initial.allowCanadianRecipients)
  const [blockRisky, setBlockRisky] = useState(initial.blockRiskyEmails)

  const [saving, setSaving] = useState(false)
  const [pausing, setPausing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const timezoneOptions = US_TIMEZONES.some((tz) => tz.value === timezone)
    ? US_TIMEZONES
    : [...US_TIMEZONES, { value: timezone, label: timezone }]

  function toggleDay(day: number) {
    setSendDays((prev) => {
      const next = new Set(prev)
      if (next.has(day)) {
        next.delete(day)
      } else {
        next.add(day)
      }
      return next
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const result = await patchSettings({
      escalationEmail: escalationEmail.trim() || null,
      timezone,
      businessHoursStart,
      businessHoursEnd,
      sendDays: Array.from(sendDays),
      guardrailBlockedPhrases: textToList(blockedPhrases),
      guardrailAllowedWords: textToList(allowedWords),
      businessName: businessName.trim() || null,
      postalAddress: postalAddress.trim() || null,
      allowCanadianRecipients: allowCanadian,
      blockRiskyEmails: blockRisky,
    })

    setSaving(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setSettings(result.data)
  }

  async function handleTogglePause() {
    setPausing(true)
    setError(null)

    const result = await patchSettings({ sendingPaused: !settings.sendingPaused })

    setPausing(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setSettings(result.data)
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <h2 className="text-[var(--text-primary)] text-sm font-medium">Sending schedule</h2>
        <Button
          type="button"
          variant={settings.sendingPaused ? 'primary' : 'danger'}
          size="sm"
          onClick={handleTogglePause}
          disabled={pausing}
        >
          {pausing ? 'Saving…' : settings.sendingPaused ? 'Resume sending' : 'Pause all sending'}
        </Button>
      </div>

      {settings.sendingPaused && settings.pausedReason && (
        <p className="text-[var(--status-danger)] text-xs">{settings.pausedReason}</p>
      )}

      {!settings.postalAddress && (
        <p role="alert" className="text-[var(--status-danger)] text-xs">
          Sending is blocked until you add your business mailing address below. US law (CAN-SPAM) requires it in every email.
        </p>
      )}

      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="businessName">
            Business name
          </label>
          <Input
            id="businessName"
            placeholder="Acme Snow & Paving LLC"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>

        <div>
          <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="postalAddress">
            Mailing address
          </label>
          <textarea
            id="postalAddress"
            rows={2}
            placeholder={'123 Main St\nBuffalo, NY 14201'}
            value={postalAddress}
            onChange={(e) => setPostalAddress(e.target.value)}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] resize-none"
          />
          <p className="text-[var(--text-muted)] text-xs mt-1">
            Shown at the bottom of every email (required by CAN-SPAM). A PO box registered with USPS is fine.
          </p>
        </div>

        <div>
          <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="escalationEmail">
            Escalation email
          </label>
          <Input
            id="escalationEmail"
            type="email"
            placeholder="you@company.com"
            value={escalationEmail}
            onChange={(e) => setEscalationEmail(e.target.value)}
            required
          />
          <p className="text-[var(--text-muted)] text-xs mt-1">Reply alerts are sent here.</p>
        </div>

        <div>
          <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="timezone">
            Timezone
          </label>
          <Select id="timezone" className="w-full" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timezoneOptions.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </Select>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="businessHoursStart">
              Start hour
            </label>
            <Input
              id="businessHoursStart"
              type="number"
              min={0}
              max={24}
              value={businessHoursStart}
              onChange={(e) => setBusinessHoursStart(Number(e.target.value))}
            />
          </div>
          <div className="flex-1">
            <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="businessHoursEnd">
              End hour
            </label>
            <Input
              id="businessHoursEnd"
              type="number"
              min={0}
              max={24}
              value={businessHoursEnd}
              onChange={(e) => setBusinessHoursEnd(Number(e.target.value))}
            />
          </div>
        </div>

        <div>
          <span className="text-[var(--text-secondary)] text-xs font-medium block mb-1">Send days</span>
          <div className="flex gap-1">
            {DAY_LABELS.map((label, day) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                className={`flex-1 text-xs py-1.5 rounded-[var(--radius-btn)] border transition-colors ${
                  sendDays.has(day)
                    ? 'bg-[var(--accent-indigo)] text-[var(--text-inverse)] border-[var(--accent-indigo)]'
                    : 'border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--border-glow)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="blockedPhrases">
            Blocked phrases
          </label>
          <textarea
            id="blockedPhrases"
            value={blockedPhrases}
            onChange={(e) => setBlockedPhrases(e.target.value)}
            placeholder={'One phrase per line'}
            rows={3}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] transition-all duration-[var(--transition-base)] hover:border-[var(--border-glow)]"
          />
        </div>

        <div>
          <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="allowedWords">
            Always-allowed words
          </label>
          <textarea
            id="allowedWords"
            value={allowedWords}
            onChange={(e) => setAllowedWords(e.target.value)}
            placeholder={'One word per line'}
            rows={3}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] transition-all duration-[var(--transition-base)] hover:border-[var(--border-glow)]"
          />
        </div>

        {error && <p className="text-[var(--status-danger)] text-xs">{error}</p>}

        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={allowCanadian}
            onChange={(e) => setAllowCanadian(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Allow Canadian recipients. Leave off for cold outreach: Canada&apos;s anti-spam law (CASL) requires consent, so
            Canadian leads are never emailed unless you have documented consent and turn this on.
          </span>
        </label>

        <label className="flex items-start gap-2 text-xs text-[var(--text-secondary)]">
          <input
            type="checkbox"
            checked={blockRisky}
            onChange={(e) => setBlockRisky(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Block risky emails (catch-all / unknown). Off by default: these addresses can&apos;t be confirmed, so some
            will bounce. Turn this on if your bounce rate climbs.
          </span>
        </label>

        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </form>
    </div>
  )
}
