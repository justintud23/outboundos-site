'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog } from '@/components/ui/dialog'
import type { TemplateDTO } from '../types'

const PROMPT_TYPES = [
  { value: 'LEAD_SCORING', label: 'Lead Scoring' },
  { value: 'EMAIL_DRAFT', label: 'Email Draft' },
  { value: 'REPLY_CLASSIFICATION', label: 'Reply Classification' },
  { value: 'SUBJECT_LINE', label: 'Subject Line' },
] as const

interface TemplateEditorModalProps {
  template: TemplateDTO | null  // null = create mode
  onClose: () => void
  onSaved: () => void
}

export function TemplateEditorModal({ template, onClose, onSaved }: TemplateEditorModalProps) {
  const isEditing = !!template
  const [name, setName] = useState(template?.name ?? '')
  const [promptType, setPromptType] = useState(template?.promptType ?? 'EMAIL_DRAFT')
  const [body, setBody] = useState(template?.body ?? '')
  const [notes, setNotes] = useState(template?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const url = isEditing ? `/api/templates/${template.id}` : '/api/templates'
    const method = isEditing ? 'PATCH' : 'POST'

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        ...(isEditing ? {} : { promptType }),
        body,
        notes: notes || null,
      }),
    })

    setSaving(false)

    if (!res.ok) {
      const data = await res.json().catch(() => null)
      setError(data?.error ?? 'Failed to save template')
      return
    }

    onSaved()
  }

  return (
    <Dialog
      title={isEditing ? 'Edit Template' : 'Create Template'}
      size="lg"
      busy={saving}
      onClose={onClose}
      footer={
        <Button type="submit" variant="primary" size="sm" disabled={saving} onClick={handleSubmit}>
          {saving ? 'Saving\u2026' : isEditing ? 'Save Changes' : 'Create Template'}
        </Button>
      }
    >
      <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
        <div>
          <label className="block text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide mb-1">
            Name
          </label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cold Outreach v2"
            required
            disabled={saving}
          />
        </div>

        {!isEditing && (
          <div>
            <label className="block text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide mb-1">
              Type
            </label>
            <Select
              value={promptType}
              onChange={(e) => setPromptType(e.target.value as typeof promptType)}
              disabled={saving}
              className="w-full"
            >
              {PROMPT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </div>
        )}

        <div>
          <label className="block text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide mb-1">
            Prompt Body
          </label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            required
            disabled={saving}
            placeholder="Write the system prompt for the AI..."
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)] resize-none placeholder:text-[var(--text-muted)]"
          />
        </div>

        <div>
          <label className="block text-[var(--text-muted)] text-xs font-medium uppercase tracking-wide mb-1">
            Notes (optional)
          </label>
          <Input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Internal notes about this template"
            disabled={saving}
          />
        </div>

        {error && (
          <p className="text-[var(--status-danger)] text-sm bg-[var(--status-danger-bg)] border border-[var(--status-danger)]/30 rounded-[var(--radius-btn)] px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  )
}
