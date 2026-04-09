'use client'

import { useState, useCallback } from 'react'
import { ThreadList } from '@/features/inbox/components/thread-list'
import { ThreadDetail } from '@/features/inbox/components/thread-detail'
import type { InboxThreadDTO, InboxFilter, ThreadDetailDTO } from '@/features/inbox/types'

interface InboxClientProps {
  initialThreads: InboxThreadDTO[]
  initialTotal: number
}

export function InboxClient({ initialThreads, initialTotal }: InboxClientProps) {
  const [threads, setThreads] = useState(initialThreads)
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null)
  const [threadDetail, setThreadDetail] = useState<ThreadDetailDTO | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<InboxFilter>('all')

  const handleSelectThread = useCallback(async (leadId: string) => {
    setSelectedLeadId(leadId)
    setLoading(true)

    try {
      const res = await fetch(`/api/inbox/${leadId}`)
      if (res.ok) {
        const detail = await res.json() as ThreadDetailDTO
        setThreadDetail(detail)

        const thread = threads.find((t) => t.leadId === leadId)
        if (thread && thread.unreadCount > 0) {
          await fetch(`/api/inbox/${leadId}/read`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isRead: true }),
          })

          setThreads((prev) =>
            prev.map((t) =>
              t.leadId === leadId ? { ...t, unreadCount: 0 } : t,
            ),
          )
        }
      }
    } finally {
      setLoading(false)
    }
  }, [threads])

  const handleFilterChange = useCallback(async (newFilter: InboxFilter) => {
    setFilter(newFilter)
    setSelectedLeadId(null)
    setThreadDetail(null)
    window.location.href = `/inbox?filter=${newFilter}`
  }, [])

  const handleBack = useCallback(() => {
    setSelectedLeadId(null)
    setThreadDetail(null)
  }, [])

  return (
    <div className="flex h-full">
      <div
        className={[
          'border-r border-[var(--border-default)] flex-shrink-0 overflow-hidden',
          'lg:w-[40%] lg:block',
          selectedLeadId ? 'hidden' : 'w-full',
        ].join(' ')}
      >
        <ThreadList
          threads={threads}
          selectedLeadId={selectedLeadId}
          filter={filter}
          onSelectThread={handleSelectThread}
          onFilterChange={handleFilterChange}
        />
      </div>

      <div
        className={[
          'flex-1 overflow-hidden',
          selectedLeadId ? 'block' : 'hidden lg:block',
        ].join(' ')}
      >
        <ThreadDetail
          thread={threadDetail}
          loading={loading}
          onBack={handleBack}
        />
      </div>
    </div>
  )
}
