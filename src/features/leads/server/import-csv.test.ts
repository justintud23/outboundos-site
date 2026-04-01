import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ImportStatus, LeadSource } from '@prisma/client'

// Mock Prisma
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    importBatch: {
      create: vi.fn(),
      update: vi.fn(),
    },
    lead: {
      upsert: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db/prisma'
import { importCsv } from './import-csv'

const mockBatch = {
  id: 'batch-1',
  organizationId: 'org-1',
  fileName: 'leads.csv',
  rowCount: 0,
  successCount: 0,
  errorCount: 0,
  status: ImportStatus.PENDING,
  errorLog: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('importCsv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates an ImportBatch and upserts leads from valid CSV', async () => {
    const csvContent = `email,first_name,last_name,company,title
alice@acme.com,Alice,Smith,Acme,VP Sales
bob@corp.com,Bob,Jones,Corp,CTO`

    const mockBatchCreate = vi.mocked(prisma.importBatch.create)
    const mockBatchUpdate = vi.mocked(prisma.importBatch.update)
    const mockLeadUpsert = vi.mocked(prisma.lead.upsert)

    mockBatchCreate.mockResolvedValueOnce(mockBatch)
    mockLeadUpsert.mockResolvedValue({
      id: 'lead-1',
      organizationId: 'org-1',
      importBatchId: 'batch-1',
      email: 'alice@acme.com',
      firstName: 'Alice',
      lastName: 'Smith',
      company: 'Acme',
      title: 'VP Sales',
      linkedinUrl: null,
      phone: null,
      source: LeadSource.CSV,
      status: 'NEW' as const,
      score: null,
      scoreReason: null,
      scoredAt: null,
      customFields: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    mockBatchUpdate.mockResolvedValue({ ...mockBatch, successCount: 2, status: ImportStatus.COMPLETED })

    const result = await importCsv({ organizationId: 'org-1', csvContent, fileName: 'leads.csv' })

    expect(mockBatchCreate).toHaveBeenCalledOnce()
    expect(mockLeadUpsert).toHaveBeenCalledTimes(2)
    expect(result.batch.successCount).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  it('records errors for invalid rows and continues', async () => {
    const csvContent = `email,first_name
not-an-email,Alice
valid@example.com,Bob`

    vi.mocked(prisma.importBatch.create).mockResolvedValueOnce(mockBatch)
    vi.mocked(prisma.lead.upsert).mockResolvedValue({
      id: 'lead-2',
      organizationId: 'org-1',
      importBatchId: 'batch-1',
      email: 'valid@example.com',
      firstName: 'Bob',
      lastName: null,
      company: null,
      title: null,
      linkedinUrl: null,
      phone: null,
      source: LeadSource.CSV,
      status: 'NEW' as const,
      score: null,
      scoreReason: null,
      scoredAt: null,
      customFields: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    vi.mocked(prisma.importBatch.update).mockResolvedValue({
      ...mockBatch,
      successCount: 1,
      errorCount: 1,
    })

    const result = await importCsv({ organizationId: 'org-1', csvContent, fileName: 'test.csv' })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.row).toBe(1)
  })

  it('returns FAILED batch with error for empty CSV', async () => {
    const csvContent = `email,first_name` // header only, no data rows

    vi.mocked(prisma.importBatch.create).mockResolvedValueOnce(mockBatch)
    vi.mocked(prisma.importBatch.update).mockResolvedValue({
      ...mockBatch,
      status: ImportStatus.FAILED,
    })

    const result = await importCsv({ organizationId: 'org-1', csvContent, fileName: 'empty.csv' })

    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.message).toContain('no data rows')
    expect(result.leads).toHaveLength(0)
  })
})
