'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface MicrosoftCardProps {
  connected: boolean
  mailboxEmails: string[]
}

interface GraphUser {
  id: string
  email: string
  displayName: string
}

const CONNECT_MESSAGES: Record<string, string> = {
  connected: 'Microsoft 365 connected.',
  denied: 'Admin consent was not granted.',
  state_mismatch: 'Connection expired — try again.',
  error: 'Something went wrong saving the connection.',
}

export function MicrosoftCard({ connected, mailboxEmails }: MicrosoftCardProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const statusParam = searchParams.get('microsoft')
  const statusMessage = statusParam ? CONNECT_MESSAGES[statusParam] : null

  const [users, setUsers] = useState<GraphUser[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const existing = new Set(mailboxEmails.map((e) => e.toLowerCase()))

  async function handleLoadUsers() {
    setLoadingUsers(true)
    setError(null)

    const res = await fetch('/api/integrations/microsoft/users')
    const data = await res.json().catch(() => null)

    setLoadingUsers(false)

    if (!res.ok) {
      setError((data as { error?: string } | null)?.error ?? 'Failed to load Microsoft 365 users.')
      return
    }

    setUsers(data as GraphUser[])
    setSelected(new Set())
  }

  function toggleUser(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function handleImport() {
    if (!users) return
    setImporting(true)
    setError(null)

    const selectedUsers = users.filter((u) => selected.has(u.id))
    const res = await fetch('/api/integrations/microsoft/mailboxes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ users: selectedUsers }),
    })
    const data = await res.json().catch(() => null)

    setImporting(false)

    if (!res.ok) {
      setError((data as { error?: string } | null)?.error ?? 'Failed to import mailboxes.')
      return
    }

    setUsers(null)
    setSelected(new Set())
    router.refresh()
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] p-4 space-y-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between">
        <h2 className="text-[var(--text-primary)] text-sm font-medium">Microsoft 365</h2>
        {connected && <Badge variant="success">Connected</Badge>}
      </div>

      {statusMessage && <p className="text-[var(--text-secondary)] text-xs">{statusMessage}</p>}

      {!connected ? (
        <div className="space-y-3">
          <p className="text-[var(--text-muted)] text-xs">
            Connect the Microsoft 365 account that holds your sending domains. You must be its Global
            Admin.
          </p>
          <a href="/api/integrations/microsoft/connect">
            <Button variant="primary" size="sm" as="span">
              Connect Microsoft 365
            </Button>
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          <Button variant="outline" size="sm" onClick={handleLoadUsers} disabled={loadingUsers}>
            {loadingUsers ? 'Loading…' : 'Load mailboxes'}
          </Button>

          {users && users.length > 0 && (
            <div className="space-y-2">
              <div className="max-h-64 overflow-y-auto space-y-1 border border-[var(--border-subtle)] rounded-[var(--radius-btn)] p-2">
                {users.map((u) => {
                  const alreadyImported = existing.has(u.email.toLowerCase())
                  return (
                    <label
                      key={u.id}
                      className={`flex items-center gap-3 px-2 py-1.5 rounded-[var(--radius-btn)] ${alreadyImported ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[var(--bg-surface-raised)] cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(u.id)}
                        onChange={() => !alreadyImported && toggleUser(u.id)}
                        disabled={alreadyImported}
                        className="accent-[var(--accent-indigo)]"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-[var(--text-primary)] text-sm truncate">{u.displayName}</p>
                        <p className="text-[var(--text-muted)] text-xs truncate">{u.email}</p>
                      </div>
                      {alreadyImported && <span className="text-[var(--text-muted)] text-xs">Imported</span>}
                    </label>
                  )
                })}
              </div>
              <Button variant="primary" size="sm" onClick={handleImport} disabled={importing || selected.size === 0}>
                {importing ? 'Importing…' : `Import selected (${selected.size})`}
              </Button>
            </div>
          )}

          {users && users.length === 0 && (
            <p className="text-[var(--text-muted)] text-xs">No new mailboxes found.</p>
          )}
        </div>
      )}

      {error && <p className="text-[var(--status-danger)] text-xs">{error}</p>}
    </div>
  )
}
