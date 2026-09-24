'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function NewCampaignForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        setError(data?.error ?? 'Failed to create campaign')
        return
      }
      const { id } = (await res.json()) as { id: string; name: string }
      router.push(`/campaigns/${id}`)
    } catch {
      setError('Failed to create campaign')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="flex items-start gap-3">
      <Input
        placeholder="New campaign name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="flex-1"
      />
      <Button type="submit" disabled={saving || !name.trim()}>
        {saving ? 'Creating…' : 'Create Campaign'}
      </Button>
      {error && <p role="alert" className="text-[var(--status-danger)] text-xs self-center">{error}</p>}
    </form>
  )
}
