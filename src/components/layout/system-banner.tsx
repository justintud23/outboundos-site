import Link from 'next/link'
import { auth } from '@clerk/nextjs/server'
import { AlertTriangle } from 'lucide-react'
import { prisma } from '@/lib/db/prisma'
import { getStaleJobs } from '@/lib/cron'

// Server component: shown above every dashboard page when automatic sending is
// paused or the external scheduler has gone quiet.
export async function SystemBanner() {
  try {
    const { orgId } = await auth()
    if (!orgId) return null

    const org = await prisma.organization.findUnique({
      where: { clerkId: orgId },
      select: { sendingPaused: true, pausedReason: true, msTenantId: true },
    })
    if (!org?.msTenantId) return null

    const stale = await getStaleJobs()
    const messages: string[] = []
    if (org.sendingPaused) messages.push(`Sending is paused${org.pausedReason ? `: ${org.pausedReason}` : '.'}`)
    if (stale.length > 0) messages.push(`Background jobs haven't run in 30+ minutes (${stale.join(', ')}).`)
    if (messages.length === 0) return null

    return (
      <div role="alert" className="flex items-start gap-3 px-6 py-3 bg-[var(--status-danger-bg)] border-b border-[var(--status-danger)] text-sm text-[var(--text-primary)]">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[var(--status-danger)]" aria-hidden />
        <div className="space-y-1">
          {messages.map((m) => <p key={m}>{m}</p>)}
          <Link href="/settings" className="text-[var(--accent-indigo)] text-xs">Open settings →</Link>
        </div>
      </div>
    )
  } catch (err) {
    console.error('[SystemBanner]', err)
    return null
  }
}
