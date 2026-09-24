'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface RetrySendButtonProps {
  messageId: string
  className?: string
}

/** Puts a FAILED send-queue message back on the queue (POST /api/messages/[id]/retry). */
export function RetrySendButton({ messageId, className }: RetrySendButtonProps) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function retry() {
    setState('busy')
    setError(null)
    try {
      const res = await fetch(`/api/messages/${messageId}/retry`, { method: 'POST' })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        setError(data?.error ?? 'Could not retry this send.')
        setState('error')
        return
      }
      setState('done')
      router.refresh()
    } catch {
      setError('Could not retry this send.')
      setState('error')
    }
  }

  if (state === 'done') {
    return <span className="text-[var(--text-muted)] text-xs">Queued</span>
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void retry()}
        disabled={state === 'busy'}
        className={
          className ??
          'text-xs px-3 py-1 rounded-[var(--radius-btn)] bg-[var(--status-danger-bg)] text-[var(--status-danger)] hover:bg-[color-mix(in_srgb,var(--status-danger)_22%,transparent)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
        }
      >
        {state === 'busy' ? 'Retrying…' : 'Retry'}
      </button>
      {error && (
        <span role="alert" className="text-[var(--status-danger)] text-[11px]">
          {error}
        </span>
      )}
    </span>
  )
}
