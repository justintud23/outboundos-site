'use client'

import { useState, useRef } from 'react'
import { Upload, Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ImportBatchResult } from '../types'

const SAMPLE_CSV = [
  'email,firstName,lastName,company,title',
  'alice@acme.com,Alice,Smith,Acme Corp,VP of Engineering',
  'bob@widgets.io,Bob,Jones,Widgets Inc,Head of Product',
].join('\n')

function downloadSampleCsv() {
  const blob = new Blob([SAMPLE_CSV], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sample-leads.csv'
  a.click()
  URL.revokeObjectURL(url)
}

interface CsvUploadFormProps {
  onSuccess: (result: ImportBatchResult) => void
}

export function CsvUploadForm({ onSuccess }: CsvUploadFormProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/leads/import', {
        method: 'POST',
        body: formData,
      })

      const data = (await response.json()) as ImportBatchResult & { error?: string }

      if (!response.ok) {
        setError(data.error ?? 'Import failed')
        return
      }

      onSuccess(data)
    } catch {
      setError('Network error — please try again.')
    } finally {
      setUploading(false)
      // Reset input so same file can be re-uploaded
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFileChange}
          id="csv-upload"
        />
        <button
          type="button"
          onClick={downloadSampleCsv}
          className="flex items-center gap-1.5 text-xs text-[#6366f1] hover:text-[#818cf8] transition-colors"
        >
          <Download size={12} />
          Sample CSV
        </button>
        <label htmlFor="csv-upload">
          <Button
            as="span"
            variant="primary"
            size="sm"
            disabled={uploading}
            className="cursor-pointer"
          >
            <Upload size={14} className="mr-2" />
            {uploading ? 'Importing...' : 'Import CSV'}
          </Button>
        </label>
      </div>
      <p className="text-[#475569] text-xs">
        Required: <span className="text-[#94a3b8]">email</span>
        {' · '}
        Optional: <span className="text-[#94a3b8]">firstName, lastName, company, title</span>
      </p>
      {error && (
        <span className="text-[#ef4444] text-xs">{error}</span>
      )}
    </div>
  )
}
