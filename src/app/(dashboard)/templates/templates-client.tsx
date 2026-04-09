'use client'

import { useState } from 'react'
import { TemplatesTable } from '@/features/templates/components/templates-table'
import { TemplateEditorModal } from '@/features/templates/components/template-editor-modal'
import type { TemplateDTO } from '@/features/templates/types'

interface TemplatesClientProps {
  initialTemplates: TemplateDTO[]
}

export function TemplatesClient({ initialTemplates }: TemplatesClientProps) {
  const [templates, setTemplates] = useState(initialTemplates)
  const [editingTemplate, setEditingTemplate] = useState<TemplateDTO | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  function handleEdit(template: TemplateDTO) {
    setEditingTemplate(template)
  }

  async function handleActivate(templateId: string) {
    const res = await fetch(`/api/templates/${templateId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'activate' }),
    })

    if (res.ok) {
      window.location.reload()
    }
  }

  function handleDuplicate(template: TemplateDTO) {
    // Open create modal pre-filled with the template's content
    setEditingTemplate(null)
    setShowCreate(true)
    // We pass the template data via a workaround: set a "duplicating" template
    setDuplicateSource(template)
  }

  const [duplicateSource, setDuplicateSource] = useState<TemplateDTO | null>(null)

  function handleSaved() {
    setEditingTemplate(null)
    setShowCreate(false)
    setDuplicateSource(null)
    window.location.reload()
  }

  function handleClose() {
    setEditingTemplate(null)
    setShowCreate(false)
    setDuplicateSource(null)
  }

  // For duplicate: create a "new" template pre-filled with source data
  const createTemplate = duplicateSource
    ? {
        ...duplicateSource,
        id: '', // signals create mode
        name: `${duplicateSource.name} (copy)`,
        isActive: false,
      }
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-[var(--text-secondary)] text-sm">
          {templates.length} template{templates.length !== 1 ? 's' : ''}
        </p>
        <button
          onClick={() => { setShowCreate(true); setDuplicateSource(null) }}
          className="text-xs px-3 py-1.5 rounded-[var(--radius-btn)] bg-[var(--accent-indigo)] text-white hover:bg-[var(--accent-indigo-hover)] transition-colors font-medium"
        >
          Create Template
        </button>
      </div>

      <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] overflow-hidden shadow-[var(--shadow-card)]">
        <TemplatesTable
          templates={templates}
          onEdit={handleEdit}
          onActivate={handleActivate}
          onDuplicate={handleDuplicate}
        />
      </div>

      {/* Edit modal */}
      {editingTemplate && (
        <TemplateEditorModal
          template={editingTemplate}
          onClose={handleClose}
          onSaved={handleSaved}
        />
      )}

      {/* Create modal (or duplicate) */}
      {showCreate && (
        <TemplateEditorModal
          template={createTemplate}
          onClose={handleClose}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
