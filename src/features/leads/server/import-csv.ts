import Papa from 'papaparse'
import { prisma } from '@/lib/db/prisma'
import { CsvRowSchema } from '../schemas'
import type { ImportBatchResult, LeadDTO } from '../types'

interface ImportCsvInput {
  organizationId: string
  csvContent: string
  fileName: string
}

export async function importCsv({
  organizationId,
  csvContent,
  fileName,
}: ImportCsvInput): Promise<ImportBatchResult> {
  // Parse CSV — header: true maps first row to keys
  const parsed = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
  })

  const rows = parsed.data
  const errors: ImportBatchResult['errors'] = []
  const leads: LeadDTO[] = []

  // Create ImportBatch record
  const batch = await prisma.importBatch.create({
    data: {
      organizationId,
      fileName,
      rowCount: rows.length,
      status: 'PROCESSING',
    },
  })

  if (rows.length === 0) {
    const updatedBatch = await prisma.importBatch.update({
      where: { id: batch.id, organizationId },
      data: { status: 'FAILED', errorLog: [{ row: 0, message: 'CSV file contains no data rows' }] },
    })
    return {
      batch: {
        id: updatedBatch.id,
        fileName: updatedBatch.fileName,
        rowCount: updatedBatch.rowCount,
        successCount: updatedBatch.successCount,
        errorCount: updatedBatch.errorCount,
        status: updatedBatch.status,
        createdAt: updatedBatch.createdAt,
      },
      leads: [],
      errors: [{ row: 0, message: 'CSV file contains no data rows' }],
    }
  }

  // Process each row
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const rowNumber = i + 1

    if (!row) continue

    const validation = CsvRowSchema.safeParse(row)
    if (!validation.success) {
      errors.push({
        row: rowNumber,
        message: validation.error.issues.map((e) => e.message).join(', '),
      })
      continue
    }

    const data = validation.data

    try {
      const lead = await prisma.lead.upsert({
        where: {
          organizationId_email: {
            organizationId,
            email: data.email,
          },
        },
        update: {
          firstName: data.first_name ?? undefined,
          lastName: data.last_name ?? undefined,
          company: data.company ?? undefined,
          title: data.title ?? undefined,
          linkedinUrl: data.linkedin_url || undefined,
          phone: data.phone ?? undefined,
          importBatchId: batch.id,
        },
        create: {
          organizationId,
          importBatchId: batch.id,
          email: data.email,
          firstName: data.first_name,
          lastName: data.last_name,
          company: data.company,
          title: data.title,
          linkedinUrl: data.linkedin_url || undefined,
          phone: data.phone,
          source: 'CSV',
        },
      })

      leads.push({
        id: lead.id,
        email: lead.email,
        firstName: lead.firstName,
        lastName: lead.lastName,
        company: lead.company,
        title: lead.title,
        source: lead.source,
        status: lead.status,
        score: lead.score,
        scoreReason: lead.scoreReason,
        scoredAt: lead.scoredAt,
        createdAt: lead.createdAt,
      })
    } catch (err) {
      errors.push({
        row: rowNumber,
        message: err instanceof Error ? err.message : 'Failed to upsert lead',
      })
    }
  }

  // Update batch with final counts
  const updatedBatch = await prisma.importBatch.update({
    where: { id: batch.id, organizationId },
    data: {
      successCount: leads.length,
      errorCount: errors.length,
      status: errors.length === rows.length ? 'FAILED' : 'COMPLETED',
      errorLog: errors.length > 0 ? errors : undefined,
    },
  })

  return {
    batch: {
      id: updatedBatch.id,
      fileName: updatedBatch.fileName,
      rowCount: updatedBatch.rowCount,
      successCount: updatedBatch.successCount,
      errorCount: updatedBatch.errorCount,
      status: updatedBatch.status,
      createdAt: updatedBatch.createdAt,
    },
    leads,
    errors,
  }
}
