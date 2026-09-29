'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { TeamDTO, TeamMemberDTO } from '@/features/team/server/team-settings'

interface TeamSectionProps {
  team: TeamDTO
  isAdmin: boolean
}

function mailboxLabel(count: number): string {
  return `${count} mailbox${count === 1 ? '' : 'es'}`
}

async function patchMember(memberId: string, patch: Record<string, string>): Promise<string | null> {
  const res = await fetch(`/api/team/members/${memberId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (res.ok) return null
  const data = await res.json().catch(() => null)
  return (data as { error?: string } | null)?.error ?? 'Failed to save.'
}

function AdminMemberRow({ member }: { member: TeamMemberDTO }) {
  const label = member.name ?? member.email ?? 'Unnamed'
  const [escalationEmail, setEscalationEmail] = useState(member.escalationEmail ?? '')
  const [senderFirstName, setSenderFirstName] = useState(member.senderFirstName ?? '')
  const [senderLastName, setSenderLastName] = useState(member.senderLastName ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    setError(null)
    const failure = await patchMember(member.id, { escalationEmail, senderFirstName, senderLastName })
    setSaving(false)
    if (failure) {
      setError(failure)
      return
    }
    setSaved(true)
  }

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[var(--text-primary)] text-sm">{label}</p>
          <p className="text-[var(--text-muted)] text-xs">{member.email}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={member.role === 'admin' ? 'default' : 'muted'}>{member.role}</Badge>
          <span className="text-[var(--text-muted)] text-xs">{mailboxLabel(member.mailboxCount)}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input
          type="email"
          aria-label={`${label} escalation email`}
          placeholder="Escalation email"
          value={escalationEmail}
          onChange={(e) => setEscalationEmail(e.target.value)}
        />
        <Input
          aria-label={`${label} sender first name`}
          placeholder="First name"
          value={senderFirstName}
          onChange={(e) => setSenderFirstName(e.target.value)}
        />
        <Input
          aria-label={`${label} sender last name`}
          placeholder="Last name"
          value={senderLastName}
          onChange={(e) => setSenderLastName(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void handleSave()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-[var(--status-success)] text-xs">Saved</span>}
      </div>
      {error && (
        <p role="alert" className="text-[var(--status-danger)] text-xs">
          {error}
        </p>
      )}
    </div>
  )
}

function ReadOnlyMemberRow({ member }: { member: TeamMemberDTO }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div>
        <p className="text-[var(--text-primary)] text-sm">{member.name ?? member.email ?? 'Unnamed'}</p>
        <p className="text-[var(--text-muted)] text-xs">{member.email}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant={member.role === 'admin' ? 'default' : 'muted'}>{member.role}</Badge>
        <span className="text-[var(--text-muted)] text-xs">{mailboxLabel(member.mailboxCount)}</span>
      </div>
    </div>
  )
}

/** Team roster: editable rows for admins, a read-only list for members. Admins also get the reply-copy toggle. */
export function TeamSection({ team, isAdmin }: TeamSectionProps) {
  const [copyAdminOnReplies, setCopyAdminOnReplies] = useState(team.copyAdminOnReplies)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [toggleError, setToggleError] = useState<string | null>(null)

  async function handleToggle(next: boolean) {
    const previous = copyAdminOnReplies
    setCopyAdminOnReplies(next)
    setToggleBusy(true)
    setToggleError(null)
    try {
      const res = await fetch('/api/team/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ copyAdminOnReplies: next }),
      })
      if (!res.ok) {
        setCopyAdminOnReplies(previous)
        const data = await res.json().catch(() => null)
        setToggleError((data as { error?: string } | null)?.error ?? 'Failed to update.')
      }
    } catch {
      setCopyAdminOnReplies(previous)
      setToggleError('Failed to update.')
    } finally {
      setToggleBusy(false)
    }
  }

  return (
    <div className="space-y-4 max-w-xl">
      <div>
        <h2 className="text-[var(--text-primary)] text-sm font-medium mb-1">Team</h2>
        <p className="text-[var(--text-muted)] text-xs">
          Roles are managed in Clerk. Invite or promote teammates from your Clerk organization settings.
        </p>
      </div>

      {isAdmin && (
        <div>
          <label className="flex items-center gap-2 text-[var(--text-secondary)] text-sm">
            <input
              type="checkbox"
              checked={copyAdminOnReplies}
              disabled={toggleBusy}
              onChange={(e) => void handleToggle(e.target.checked)}
              className="accent-[var(--accent-indigo)]"
            />
            CC me on reps&apos; reply alerts
          </label>
          {toggleError && (
            <p role="alert" className="text-[var(--status-danger)] text-xs mt-1">
              {toggleError}
            </p>
          )}
        </div>
      )}

      {team.members.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] divide-y divide-[var(--border-subtle)] shadow-[var(--shadow-card)]">
          {team.members.map((member) =>
            isAdmin ? <AdminMemberRow key={member.id} member={member} /> : <ReadOnlyMemberRow key={member.id} member={member} />,
          )}
        </div>
      )}
    </div>
  )
}
