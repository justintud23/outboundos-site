'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [saving, onClose])

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
    <>
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={saving ? undefined : onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed right-0 top-0 h-full w-full max-w-lg bg-[var(--bg-base)] border-l border-[var(--border-default)] z-50 flex flex-col shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-default)]">
          <h2 className="text-[var(--text-primary)] font-semibold text-sm">
            {isEditing ? 'Edit Template' : 'Create Template'}
          </h2>
          <button
            onClick={saving ? undefined : onClose}
            disabled={saving}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors text-lg leading-none disabled:opacity-50"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
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
              <select
                value={promptType}
                onChange={(e) => setPromptType(e.target.value as typeof promptType)}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-default)] text-[var(--text-primary)] rounded-[var(--radius-btn)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-indigo)] focus:shadow-[var(--focus-ring)]"
                disabled={saving}
              >
                {PROMPT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
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

        <div className="px-5 py-4 border-t border-[var(--border-default)]">
          <Button type="submit" variant="primary" size="sm" disabled={saving} onClick={handleSubmit}>
            {saving ? 'Saving\u2026' : isEditing ? 'Save Changes' : 'Create Template'}
          </Button>
        </div>
      </div>
    </>
  )
}
