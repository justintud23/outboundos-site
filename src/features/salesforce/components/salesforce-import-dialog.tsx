'use client'

import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'

type SfObject = 'Lead' | 'Contact'

interface ListView {
  id: string
  label: string
}

interface PreviewRow {
  id: string
  name: string
  email: string | null
  company: string | null
  title: string | null
}

interface Preview {
  total: number
  rows: PreviewRow[]
}

interface ImportResult {
  imported: number
  linked: number
  skipped: {
    customer: number
    openOpportunity: number
    optedOut: number
    converted: number
    noEmail: number
    invalid: number
  }
}

// Order and label match the plan's copy exactly.
const SKIP_LABELS: [keyof ImportResult['skipped'], string][] = [
  ['customer', 'customers'],
  ['openOpportunity', 'open opportunities'],
  ['optedOut', 'opted out'],
  ['converted', 'converted leads'],
  ['noEmail', 'no email'],
  ['invalid', 'invalid email'],
]

function summarize(result: ImportResult): { success: string; skip: string | null } {
  const success = `Imported ${result.imported} new leads, linked ${result.linked} existing.`

  const parts = SKIP_LABELS.map(([key, label]) => [result.skipped[key], label] as const).filter(
    ([count]) => count > 0,
  )
  const total = parts.reduce((sum, [count]) => sum + count, 0)
  const skip = total > 0 ? `${total} skipped: ${parts.map(([count, label]) => `${count} ${label}`).join(', ')}` : null

  return { success, skip }
}

interface SalesforceImportDialogProps {
  isAdmin: boolean
  onImported: () => void
}

export function SalesforceImportDialog({ isAdmin, onImported }: SalesforceImportDialogProps) {
  const objectId = useId()
  const listViewId = useId()
  const ownersId = useId()

  const [open, setOpen] = useState(false)
  const [object, setObject] = useState<SfObject>('Lead')
  const [listViews, setListViews] = useState<ListView[]>([])
  const [selectedListViewId, setSelectedListViewId] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [useSalesforceOwners, setUseSalesforceOwners] = useState(false)
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ success: string; skip: string | null } | null>(null)

  async function loadListViews(nextObject: SfObject) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/salesforce/list-views?object=${nextObject}`)
      const data = (await res.json().catch(() => null)) as { listViews?: ListView[]; error?: string } | null
      if (!res.ok) {
        setError(data?.error ?? 'Could not load list views.')
        setListViews([])
        return
      }
      setListViews(data?.listViews ?? [])
    } catch {
      setError('Network error — please try again.')
      setListViews([])
    } finally {
      setBusy(false)
    }
  }

  async function loadPreview(nextObject: SfObject, id: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/salesforce/list-views/${id}/preview?object=${nextObject}`)
      const data = (await res.json().catch(() => null)) as (Preview & { error?: string }) | null
      if (!res.ok) {
        setError(data?.error ?? 'Could not load the preview.')
        setPreview(null)
        return
      }
      setPreview(data)
    } catch {
      setError('Network error — please try again.')
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  function handleOpen() {
    setOpen(true)
    void loadListViews(object)
  }

  function handleObjectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextObject = e.target.value as SfObject
    setObject(nextObject)
    setSelectedListViewId('')
    setPreview(null)
    setResult(null)
    setError(null)
    void loadListViews(nextObject)
  }

  function handleListViewChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value
    setSelectedListViewId(id)
    setPreview(null)
    setResult(null)
    setError(null)
    if (id) void loadPreview(object, id)
  }

  async function handleImport() {
    const listView = listViews.find((lv) => lv.id === selectedListViewId)
    if (!listView) return

    setBusy(true)
    setImporting(true)
    setError(null)
    try {
      const res = await fetch('/api/salesforce/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          object,
          listViewId: listView.id,
          listViewLabel: listView.label,
          useSalesforceOwners,
        }),
      })
      const data = (await res.json().catch(() => null)) as (ImportResult & { error?: string }) | null
      if (!res.ok) {
        setError(data?.error ?? 'Import failed')
        return
      }
      setResult(summarize(data as ImportResult))
      onImported()
    } catch {
      setError('Network error — please try again.')
    } finally {
      setBusy(false)
      setImporting(false)
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={handleOpen}>
        Import from Salesforce
      </Button>
    )
  }

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-default)] rounded-[var(--radius-card)] shadow-[var(--shadow-card)] p-4 space-y-4 w-full max-w-xl">
      <div className="flex items-center justify-between">
        <h3 className="text-[var(--text-primary)] text-sm font-medium">Import from Salesforce</h3>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs transition-colors"
        >
          Close
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={objectId} className="text-[var(--text-secondary)] text-xs font-medium">
          Record type
        </label>
        <Select id={objectId} value={object} onChange={handleObjectChange} disabled={busy}>
          <option value="Lead">Leads</option>
          <option value="Contact">Contacts</option>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={listViewId} className="text-[var(--text-secondary)] text-xs font-medium">
          List view
        </label>
        <Select id={listViewId} value={selectedListViewId} onChange={handleListViewChange} disabled={busy}>
          <option value="">Choose a list view</option>
          {listViews.map((lv) => (
            <option key={lv.id} value={lv.id}>
              {lv.label}
            </option>
          ))}
        </Select>
      </div>

      {preview && (
        <div className="space-y-2">
          <p className="text-[var(--text-secondary)] text-xs">{preview.total} records in this view</p>
          {preview.total > 2000 && (
            <p className="text-[var(--text-muted)] text-xs">Only the first 2,000 will be imported.</p>
          )}
          {preview.rows.length > 0 && (
            <div className="border border-[var(--border-default)] rounded-[var(--radius-btn)] overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[var(--bg-surface-raised)] text-[var(--text-muted)]">
                    <th className="text-left px-2 py-1.5 font-medium">Name</th>
                    <th className="text-left px-2 py-1.5 font-medium">Email</th>
                    <th className="text-left px-2 py-1.5 font-medium">Company</th>
                    <th className="text-left px-2 py-1.5 font-medium">Title</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.id} className="border-t border-[var(--border-default)] text-[var(--text-secondary)]">
                      <td className="px-2 py-1.5">{row.name}</td>
                      <td className="px-2 py-1.5">{row.email}</td>
                      <td className="px-2 py-1.5">{row.company}</td>
                      <td className="px-2 py-1.5">{row.title}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {isAdmin && (
        <label htmlFor={ownersId} className="flex items-center gap-2 text-[var(--text-secondary)] text-sm">
          <input
            id={ownersId}
            type="checkbox"
            checked={useSalesforceOwners}
            onChange={(e) => setUseSalesforceOwners(e.target.checked)}
            disabled={busy}
          />
          Use Salesforce owners where they match a rep
        </label>
      )}

      {result && (
        <div className="space-y-0.5">
          <p className="text-[var(--status-success)] text-xs">{result.success}</p>
          {result.skip && <p className="text-[var(--text-muted)] text-xs">{result.skip}</p>}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[var(--status-danger)] text-xs">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="button" variant="primary" size="sm" disabled={busy || !selectedListViewId} onClick={() => void handleImport()}>
          {importing ? 'Importing...' : 'Import'}
        </Button>
      </div>
    </div>
  )
}
