import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { importCsv } from '@/features/leads/server/import-csv'
import { scoreLeads } from '@/features/leads/server/score-leads'

export async function POST(request: Request) {
  const { orgId } = await auth()

  if (!orgId) {
    return NextResponse.json(
      { error: 'No active organization. Select an organization to continue.' },
      { status: 403 },
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!file.name.endsWith('.csv')) {
    return NextResponse.json({ error: 'File must be a .csv' }, { status: 400 })
  }

  const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File too large. Maximum size is 5 MB.' }, { status: 400 })
  }

  let csvContent: string
  try {
    csvContent = await file.text()
  } catch {
    return NextResponse.json({ error: 'Failed to read file contents' }, { status: 400 })
  }

  if (!csvContent.trim()) {
    return NextResponse.json({ error: 'CSV file is empty' }, { status: 400 })
  }

  // Import leads
  const importResult = await importCsv({
    organizationId: orgId,
    csvContent,
    fileName: file.name,
  })

  // Score imported leads (fire-and-forget errors — import already succeeded)
  let scoreResults: Awaited<ReturnType<typeof scoreLeads>> = []
  if (importResult.leads.length > 0) {
    try {
      scoreResults = await scoreLeads({
        organizationId: orgId,
        leadIds: importResult.leads.map((l) => l.id),
      })
    } catch (err) {
      console.error('Scoring failed after import:', err)
      // Import succeeded — return result with scoring failure noted
      return NextResponse.json({
        ...importResult,
        scoringError: 'Scoring failed — leads were imported but not yet scored.',
      })
    }
  }

  return NextResponse.json({ ...importResult, scores: scoreResults })
}
