'use client'

import { useState, useRef } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ImportBatchResult } from '../types'

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
    <div className="flex items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        className="hidden"
        onChange={handleFileChange}
        id="csv-upload"
      />
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
      {error && (
        <span className="text-[#ef4444] text-sm">{error}</span>
      )}
    </div>
  )
}
