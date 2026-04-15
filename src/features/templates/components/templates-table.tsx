'use client'

import { Badge } from '@/components/ui/badge'
import { formatEnumLabel } from '@/lib/format'
import type { TemplateDTO } from '../types'

interface TemplatesTableProps {
  templates: TemplateDTO[]
  onEdit: (template: TemplateDTO) => void
  onActivate: (templateId: string) => void
  onDuplicate: (template: TemplateDTO) => void
}

function relativeTime(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return `${Math.floor(diffDay / 30)}mo ago`
}

export function TemplatesTable({ templates, onEdit, onActivate, onDuplicate }: TemplatesTableProps) {
  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <p className="text-[var(--text-muted)] text-sm">No templates yet.</p>
        <p className="text-[var(--text-muted)] text-xs mt-1 opacity-60">Create a template to customize your AI prompts.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-default)]">
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Name</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Type</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Version</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Status</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden md:table-cell">Preview</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide hidden lg:table-cell">Updated</th>
            <th className="text-left py-3 px-4 text-[var(--text-muted)] font-medium text-xs uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody>
          {templates.map((template) => (
            <tr
              key={template.id}
              className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-surface-raised)] transition-colors duration-[var(--transition-fast)]"
            >
              <td className="py-3 px-4">
                <p className="text-[var(--text-primary)] font-medium">{template.name}</p>
                {template.notes && (
                  <p className="text-[var(--text-muted)] text-xs mt-0.5 truncate max-w-[200px]">{template.notes}</p>
                )}
              </td>
              <td className="py-3 px-4">
                <Badge variant="default">{formatEnumLabel(template.promptType)}</Badge>
              </td>
              <td className="py-3 px-4 text-[var(--text-secondary)] tabular-nums">v{template.version}</td>
              <td className="py-3 px-4">
                <Badge variant={template.isActive ? 'success' : 'muted'}>
                  {template.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </td>
              <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden md:table-cell max-w-[200px] truncate">
                {template.body.slice(0, 80)}
              </td>
              <td className="py-3 px-4 text-[var(--text-muted)] text-xs hidden lg:table-cell">
                {relativeTime(template.updatedAt)}
              </td>
              <td className="py-3 px-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => onEdit(template)}
                    className="text-xs font-medium text-[var(--accent-indigo)] hover:text-[var(--accent-indigo-hover)] transition-colors duration-[var(--transition-fast)] cursor-pointer"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => onDuplicate(template)}
                    className="text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors duration-[var(--transition-fast)] cursor-pointer"
                  >
                    Duplicate
                  </button>
                  {!template.isActive && (
                    <button
                      onClick={() => onActivate(template.id)}
                      className="text-xs font-medium text-[var(--status-success)] hover:bg-[var(--status-success-bg)] px-1.5 py-0.5 rounded-[var(--radius-btn)] transition-colors duration-[var(--transition-fast)] cursor-pointer"
                    >
                      Activate
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
