'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

interface MySettingsProps {
  memberId: string
  escalationEmail: string | null
  senderFirstName: string | null
  senderLastName: string | null
}

/** The signed-in member's own settings: where their reply alerts go, and the name used to sign their campaigns. */
export function MySettings({ memberId, escalationEmail, senderFirstName, senderLastName }: MySettingsProps) {
  const [email, setEmail] = useState(escalationEmail ?? '')
  const [firstName, setFirstName] = useState(senderFirstName ?? '')
  const [lastName, setLastName] = useState(senderLastName ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setError(null)

    const res = await fetch(`/api/team/members/${memberId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ escalationEmail: email, senderFirstName: firstName, senderLastName: lastName }),
    })

    setSaving(false)

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError((data as { error?: string } | null)?.error ?? 'Failed to save.')
      return
    }
    setSaved(true)
  }

  return (
    <div className="space-y-3 max-w-xl">
      <div>
        <h2 className="text-[var(--text-primary)] text-sm font-medium mb-1">My settings</h2>
        <p className="text-[var(--text-muted)] text-xs">
          Where your reply alerts go, and the name used to sign your campaigns.
        </p>
      </div>
      <form onSubmit={(e) => void handleSave(e)} className="space-y-3">
        <div>
          <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="my-settings-escalation-email">
            Escalation email
          </label>
          <Input
            id="my-settings-escalation-email"
            type="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="my-settings-first-name">
              First name
            </label>
            <Input id="my-settings-first-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor="my-settings-last-name">
              Last name
            </label>
            <Input id="my-settings-last-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          </div>
        </div>
        {error && (
          <p role="alert" className="text-[var(--status-danger)] text-xs">
            {error}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button type="submit" variant="primary" size="sm" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
          {saved && <span className="text-[var(--status-success)] text-xs">Saved</span>}
        </div>
      </form>
    </div>
  )
}
