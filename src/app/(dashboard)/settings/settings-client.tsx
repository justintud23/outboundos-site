'use client'

import { useState } from 'react'
import { Mail, Trash2 } from 'lucide-react'
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

  return (
    <div className="space-y-8 max-w-xl">
      {/* Section header */}
      <div>
        <h2 className="text-[#e2e8f0] text-sm font-medium mb-1">Sending mailboxes</h2>
        <p className="text-[#475569] text-xs">
          Outbound emails are sent from the active mailbox. Daily limit defaults to 50 emails/day.
        </p>
      </div>

      {/* Existing mailboxes */}
      {mailboxes.length > 0 && (
        <div className="bg-[#13151c] border border-[#1e2130] rounded-lg divide-y divide-[#1e2130]">
          {mailboxes.map((mb) => (
            <div key={mb.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <Mail size={14} className="text-[#475569] shrink-0" />
                <div>
                  <p className="text-[#e2e8f0] text-sm">{mb.displayName}</p>
                  <p className="text-[#475569] text-xs">{mb.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded ${mb.isActive ? 'bg-[#1e3a2e] text-[#4ade80]' : 'bg-[#1e2130] text-[#475569]'}`}>
                  {mb.isActive ? 'Active' : 'Inactive'}
                </span>
                <span className="text-[#475569] text-xs">{mb.sentToday}/{mb.dailyLimit} today</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add mailbox form */}
      <form onSubmit={handleAdd} className="space-y-3">
        <h3 className="text-[#94a3b8] text-xs font-medium uppercase tracking-wide">Add mailbox</h3>
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
        {error && <p className="text-[#ef4444] text-xs">{error}</p>}
        <Button type="submit" variant="primary" size="sm" disabled={saving}>
          {saving ? 'Adding…' : 'Add mailbox'}
        </Button>
      </form>
    </div>
  )
}
