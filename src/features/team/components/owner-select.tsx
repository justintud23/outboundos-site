'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Select } from '@/components/ui/select'

interface OwnerSelectMember {
  id: string
  name: string | null
  email: string | null
  role: string
}

interface OwnerSelectProps {
  /** PATCHed with `{ ownerId }` on change (e.g. `/api/campaigns/c1/owner`). */
  endpoint: string
  members: OwnerSelectMember[]
  value: string | null
  /** Optional explanatory note shown under the select. */
  note?: string
}

/** Admin-only owner picker for a campaign, lead, or mailbox. PATCHes `endpoint` and refreshes. */
export function OwnerSelect({ endpoint, members, value, note }: OwnerSelectProps) {
  const router = useRouter()
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const ownerId = e.target.value === '' ? null : e.target.value
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? 'Could not update owner.')
        return
      }
      router.refresh()
    } catch {
      setError('Could not update owner.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <label className="text-[var(--text-secondary)] text-xs font-medium block mb-1" htmlFor={id}>
        Owner
      </label>
      <Select id={id} value={value ?? ''} onChange={handleChange} disabled={busy}>
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name ?? m.email ?? 'Unnamed'}
          </option>
        ))}
      </Select>
      {note && <p className="text-[var(--text-muted)] text-xs">{note}</p>}
      {error && (
        <p role="alert" className="text-[var(--status-danger)] text-xs">
          {error}
        </p>
      )}
    </div>
  )
}
