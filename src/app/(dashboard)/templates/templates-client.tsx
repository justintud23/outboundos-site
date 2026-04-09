'use client'

import { useState } from 'react'
import { TemplatesTable } from '@/features/templates/components/templates-table'
import { TemplateEditorModal } from '@/features/templates/components/template-editor-modal'
import { formatEnumLabel } from '@/lib/format'
import type { TemplateDTO } from '@/features/templates/types'
import type { PromptType } from '@prisma/client'

const PROMPT_TYPES: PromptType[] = ['LEAD_SCORING', 'EMAIL_DRAFT', 'REPLY_CLASSIFICATION', 'SUBJECT_LINE']

interface TemplatesClientProps {
  initialTemplates: TemplateDTO[]
}

export function TemplatesClient({ initialTemplates }: TemplatesClientProps) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [editingTemplate, setEditingTemplate] = useState<TemplateDTO | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<PromptType | 'ALL'>('ALL')

  const filtered = filter === 'ALL'
    ? templates
    : templates.filter((t) => t.promptType === filter)

  async function handleActivate(templateId: string) {
    const res = await fetch(`/api/templates/${templateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate' }),
    })
    if (res.ok) window.location.reload()
  }

  async function handleDuplicate(template: TemplateDTO) {
    const res = await fetch(`/api/templates/${template.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'duplicate' }),
    })
    if (res.ok) window.location.reload()
  }

  function handleSaved() {
    setEditingTemplate(null)
    setShowCreate(false)
    window.location.reload()
  }

  function handleClose() {
    setEditingTemplate(null)
    setShowCreate(false)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <p className="text-[var(--text-secondary)] text-sm">
            {filtered.length} template{filtered.length !== 1 ? 's' : ''}
          </p>

          {/* Type filter */}
          <div className="flex gap-1">
            <button
              onClick={() => setFilter('ALL')}
              className={[
                'px-2.5 py-1 rounded-[var(--radius-btn)] text-xs font-medium transition-colors',
                filter === 'ALL'
                  ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
              ].join(' ')}
            >
              All
            </button>
            {PROMPT_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => setFilter(type)}
                className={[
                  'px-2.5 py-1 rounded-[var(--radius-btn)] text-xs font-medium transition-colors',
                  filter === type
                    ? 'bg-[var(--bg-surface-raised)] text-[var(--text-primary)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                ].join(' ')}
              >
                {formatEnumLabel(type)}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="text-xs px-3 py-1.5 rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] text-white hover:bg-[var(--accent-indigo-hover)] transition-colors font-medium"
        >
          Create Template
        </button>
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
        <TemplatesTable
          templates={filtered}
          onEdit={(t) => setEditingTemplate(t)}
          onActivate={handleActivate}
          onDuplicate={handleDuplicate}
        />
      </div>

      {editingTemplate && (
        <TemplateEditorModal
          template={editingTemplate}
          onClose={handleClose}
          onSaved={handleSaved}
        />
      )}

      {showCreate && (
        <TemplateEditorModal
          template={null}
          onClose={handleClose}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
