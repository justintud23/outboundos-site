'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface StepForm {
  subject: string
  body: string
  delayDays: number
}

interface CreateSequenceFormProps {
  campaigns: { id: string; name: string }[]
  onCreated: () => void
}

export function CreateSequenceForm({ campaigns, onCreated }: CreateSequenceFormProps) {
  const [name, setName] = useState('')
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? '')
  const [steps, setSteps] = useState<StepForm[]>([{ subject: '', body: '', delayDays: 0 }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addStep() {
    setSteps((prev) => [...prev, { subject: '', body: '', delayDays: 3 }])
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }

  function updateStep(index: number, field: keyof StepForm, value: string | number) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const res = await fetch('/api/sequences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        campaignId,
        name,
        steps: steps.map((s, i) => ({
          stepNumber: i + 1,
          subject: s.subject,
          body: s.body,
          delayDays: s.delayDays,
        })),
      }),
    })

    setSaving(false)

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? 'Failed to create sequence')
      return
    }

    onCreated()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-3">
        <Input
          placeholder="Sequence name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="flex-1"
        />
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          className="bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] text-sm rounded-[var(--radius-btn)] px-3 py-2 focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)]"
          required
        >
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        <h4 className="text-[var(--text-secondary)] text-xs font-medium uppercase tracking-wide">Steps</h4>
        {steps.map((step, i) => (
          <div key={i} className="bg-[var(--bg-surface-raised)] rounded-[var(--radius-btn)] p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[var(--text-muted)] text-xs font-medium">Step {i + 1}</span>
              <div className="flex items-center gap-2">
                <label className="text-[var(--text-muted)] text-xs">
                  Delay:
                  <input
                    type="number"
                    min={0}
                    value={step.delayDays}
                    onChange={(e) => updateStep(i, 'delayDays', parseInt(e.target.value) || 0)}
                    className="w-14 ml-1 bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] text-xs rounded px-2 py-1"
                  />
                  d
                </label>
                {steps.length > 1 && (
                  <button type="button" onClick={() => removeStep(i)} className="text-[var(--text-muted)] hover:text-[var(--status-danger)] transition-colors">
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <Input
              placeholder="Subject line"
              value={step.subject}
              onChange={(e) => updateStep(i, 'subject', e.target.value)}
              required
            />
            <textarea
              placeholder="Email body"
              value={step.body}
              onChange={(e) => updateStep(i, 'body', e.target.value)}
              rows={3}
              required
              className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] resize-none"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={addStep}
          className="flex items-center gap-1.5 text-xs text-[var(--accent-indigo)] hover:text-[var(--accent-indigo-hover)] transition-colors"
        >
          <Plus size={14} />
          Add step
        </button>
      </div>

      {error && <p className="text-[var(--status-danger)] text-xs">{error}</p>}

      <Button type="submit" variant="primary" size="sm" disabled={saving}>
        {saving ? 'Creating\u2026' : 'Create Sequence'}
      </Button>
    </form>
  )
}
