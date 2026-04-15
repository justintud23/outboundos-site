'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { LeadHeader } from '@/features/leads/components/lead-header'
import { LeadTimeline } from '@/features/leads/components/lead-timeline'
import { LeadMessages } from '@/features/leads/components/lead-messages'
import { LeadActionsPanel } from '@/features/leads/components/lead-actions-panel'
import { LeadSequenceCard } from '@/features/leads/components/lead-sequence-card'
import { executeAction } from '@/features/leads/components/inline-action-item'
import { formatEnumLabel, relativeTime } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import {
  Calendar,
  Database,
} from 'lucide-react'
import type { LeadDetailDTO, TimelineItem, LeadSequenceDTO } from '@/features/leads/types'
import type { ThreadMessageDTO } from '@/features/inbox/types'
import type { NextAction } from '@/features/actions/types'
import type { LeadStatus } from '@prisma/client'

type Tab = 'timeline' | 'messages'

const GHOST_DURATION = 3000
const DISMISS_DELAY = 300

interface LeadCommandCenterProps {
  lead: LeadDetailDTO
  timeline: TimelineItem[]
  messages: ThreadMessageDTO[]
  sequence: LeadSequenceDTO | null
  actions: NextAction[]
}

export function LeadCommandCenter({
  lead,
  timeline,
  messages,
  sequence,
  actions,
}: LeadCommandCenterProps) {
  const [activeTab, setActiveTab] = useState<Tab>('timeline')
  const router = useRouter()

  // Optimistic state
  const [ghostIds, setGhostIds] = useState<Set<string>>(new Set())
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const [optimisticStatus, setOptimisticStatus] = useState<LeadStatus | null>(null)
  const [errorActionId, setErrorActionId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Track timers and in-flight state per action for cleanup
  const ghostTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const inflightActions = useRef<Set<string>>(new Set())

  const handleExecute = useCallback(async (action: NextAction) => {
    const id = action.id

    // Clear any previous error for this action
    setErrorActionId((prev) => (prev === id ? null : prev))
    setErrorMessage((prev) => (errorActionId === id ? null : prev))

    // Phase 1: Enter ghost state immediately
    setGhostIds((prev) => new Set(prev).add(id))

    // Optimistic: update lead status for MARK_CONVERTED
    if (action.type === 'MARK_CONVERTED') {
      setOptimisticStatus('CONVERTED')
    }

    // Mark as in-flight
    inflightActions.current.add(id)

    // Schedule transition from ghost → dismissed after GHOST_DURATION
    const timer = setTimeout(() => {
      ghostTimers.current.delete(id)
      // Only dismiss if not already undone
      setGhostIds((prev) => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setDismissedIds((prev) => new Set(prev).add(id))
    }, GHOST_DURATION)
    ghostTimers.current.set(id, timer)

    // Fire the API call in background
    try {
      await executeAction(action)
      inflightActions.current.delete(id)
      // Success — refresh server data after ghost/dismiss completes
      router.refresh()
    } catch (err) {
      inflightActions.current.delete(id)

      // Cancel ghost timer
      const pendingTimer = ghostTimers.current.get(id)
      if (pendingTimer) {
        clearTimeout(pendingTimer)
        ghostTimers.current.delete(id)
      }

      // Revert: remove from ghost and dismissed
      setGhostIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setDismissedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })

      // Revert: restore lead status
      if (action.type === 'MARK_CONVERTED') {
        setOptimisticStatus(null)
      }

      // Show error
      const message = err instanceof Error ? err.message : 'Something went wrong'
      setErrorActionId(id)
      setErrorMessage(message)

      // Auto-clear error after 4s
      setTimeout(() => {
        setErrorActionId((prev) => (prev === id ? null : prev))
        setErrorMessage(null)
      }, 4000)
    }
  }, [router, errorActionId])

  const handleUndo = useCallback((action: NextAction) => {
    const id = action.id

    // Cancel ghost timer
    const timer = ghostTimers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      ghostTimers.current.delete(id)
    }

    // Remove from ghost (restores to idle)
    setGhostIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

    // Revert optimistic status if this was a MARK_CONVERTED
    if (action.type === 'MARK_CONVERTED') {
      setOptimisticStatus(null)
    }

    // Note: the API call may still be in flight — that's OK for v1.
    // The router.refresh() on success will bring server truth.
    // If the API succeeds, the next refresh will reflect the change,
    // but the user sees the row restored immediately.
  }, [])

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Lead Header */}
      <LeadHeader lead={lead} statusOverride={optimisticStatus} />

      {/* Main 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT — Primary content (2/3) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Tab switcher */}
          <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] animate-fade-in-up" style={{ animationDelay: '50ms' }}>
            <div className="flex border-b border-[var(--border-default)]">
              <button
                onClick={() => setActiveTab('timeline')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors duration-[var(--transition-fast)] cursor-pointer ${
                  activeTab === 'timeline'
                    ? 'text-[var(--accent-indigo)] border-b-2 border-[var(--accent-indigo)] -mb-px'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                Timeline
              </button>
              <button
                onClick={() => setActiveTab('messages')}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors duration-[var(--transition-fast)] cursor-pointer ${
                  activeTab === 'messages'
                    ? 'text-[var(--accent-indigo)] border-b-2 border-[var(--accent-indigo)] -mb-px'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                Messages
                {messages.length > 0 && (
                  <span className="ml-1.5 text-xs text-[var(--text-muted)]">
                    ({messages.length})
                  </span>
                )}
              </button>
            </div>

            <div className="p-5">
              {activeTab === 'timeline' && <LeadTimeline items={timeline} />}
              {activeTab === 'messages' && <LeadMessages messages={messages} />}
            </div>
          </div>
        </div>

        {/* RIGHT — Secondary content (1/3) */}
        <div className="space-y-6">
          {/* Actions Panel */}
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] animate-fade-in-up"
            style={{ animationDelay: '100ms' }}
          >
            <div className="px-5 pt-4 pb-2">
              <h2 className="text-[var(--text-muted)] text-xs font-medium uppercase tracking-wider">
                Next Actions
              </h2>
            </div>
            <div className="px-3 pb-4">
              <LeadActionsPanel
                actions={actions}
                ghostIds={ghostIds}
                dismissedIds={dismissedIds}
                errorActionId={errorActionId}
                errorMessage={errorMessage}
                onExecute={handleExecute}
                onUndo={handleUndo}
              />
            </div>
          </div>

          {/* Sequence Card */}
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] animate-fade-in-up"
            style={{ animationDelay: '150ms' }}
          >
            <div className="px-5 pt-4 pb-2">
              <h2 className="text-[var(--text-muted)] text-xs font-medium uppercase tracking-wider">
                Sequence
              </h2>
            </div>
            <div className="px-5 pb-5">
              <LeadSequenceCard sequence={sequence} />
            </div>
          </div>

          {/* Lead Metadata */}
          <div
            className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] animate-fade-in-up"
            style={{ animationDelay: '200ms' }}
          >
            <div className="px-5 pt-4 pb-2">
              <h2 className="text-[var(--text-muted)] text-xs font-medium uppercase tracking-wider">
                Details
              </h2>
            </div>
            <div className="px-5 pb-5 space-y-3">
              <MetadataRow label="Source">
                <Badge variant="muted">{formatEnumLabel(lead.source)}</Badge>
              </MetadataRow>
              {lead.scoreReason && (
                <MetadataRow label="Score Reason">
                  <span className="text-[var(--text-secondary)] text-sm">{lead.scoreReason}</span>
                </MetadataRow>
              )}
              <MetadataRow label="Created">
                <span className="flex items-center gap-1.5 text-[var(--text-secondary)] text-sm">
                  <Calendar size={12} className="text-[var(--text-muted)]" />
                  {relativeTime(lead.createdAt)}
                </span>
              </MetadataRow>
              {lead.customFields && Object.keys(lead.customFields as object).length > 0 && (
                <MetadataRow label="Custom Fields">
                  <span className="flex items-center gap-1.5 text-[var(--text-muted)] text-xs">
                    <Database size={12} />
                    {Object.keys(lead.customFields as object).length} fields
                  </span>
                </MetadataRow>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MetadataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[var(--text-muted)] text-xs flex-shrink-0">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  )
}
