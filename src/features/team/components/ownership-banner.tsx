'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

interface OwnershipBannerProps {
  isAdmin: boolean
  dismissed: boolean
  unassignedCampaigns: number
  unassignedMailboxes: number
}

/** Admin-only nudge to assign owners once anything is unassigned. Dismiss persists org-wide via PATCH /api/team/settings. */
export function OwnershipBanner({ isAdmin, dismissed: initialDismissed, unassignedCampaigns, unassignedMailboxes }: OwnershipBannerProps) {
  const [dismissed, setDismissed] = useState(initialDismissed)
  const [busy, setBusy] = useState(false)

  const total = unassignedCampaigns + unassignedMailboxes

  if (!isAdmin || dismissed || total <= 0) return null

  async function handleDismiss() {
    setBusy(true)
    try {
      const res = await fetch('/api/team/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dismissOwnershipBanner: true }),
      })
      if (res.ok) setDismissed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 bg-[var(--status-warning-bg)] border border-[var(--status-warning)] rounded-[var(--radius-card)] px-4 py-3">
      <p className="text-[var(--status-warning)] text-sm">
        {unassignedCampaigns} campaign{unassignedCampaigns === 1 ? '' : 's'} and {unassignedMailboxes} mailbox
        {unassignedMailboxes === 1 ? '' : 'es'} still need an owner.{' '}
        <Link href="/campaigns?view=team" className="underline font-medium">
          Assign campaigns
        </Link>
        {' · '}
        <Link href="/settings" className="underline font-medium">
          Assign mailboxes
        </Link>
      </p>
      <Button type="button" variant="ghost" size="sm" onClick={() => void handleDismiss()} disabled={busy}>
        Dismiss
      </Button>
    </div>
  )
}
