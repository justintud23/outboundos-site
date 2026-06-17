import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequenceEnrollment: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/features/sequences/server/run-sequence-step', () => ({
  runSequenceStep: vi.fn(),
}))

import { prisma } from '@/lib/db/prisma'
import { runSequenceStep } from '@/features/sequences/server/run-sequence-step'
import { GET } from './route'

const mockUpdateMany = prisma.sequenceEnrollment.updateMany as ReturnType<typeof vi.fn>
const mockFindMany = prisma.sequenceEnrollment.findMany as ReturnType<typeof vi.fn>
const mockUpdate = prisma.sequenceEnrollment.update as ReturnType<typeof vi.fn>
const mockRunSequenceStep = runSequenceStep as ReturnType<typeof vi.fn>

const CRON_SECRET = 'test-cron-secret'

function makeRequest(authHeader?: string): Request {
  return new Request('http://localhost/api/cron/sequence-runner', {
    method: 'GET',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = CRON_SECRET
})

afterEach(() => {
  delete process.env.CRON_SECRET
})

describe('GET /api/cron/sequence-runner', () => {
  it('returns 401 when the auth header is missing', async () => {
    const res = await GET(makeRequest())

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json).toEqual({ error: 'Unauthorized' })
    expect(mockUpdateMany).not.toHaveBeenCalled()
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('returns 401 when the auth header is wrong', async () => {
    const res = await GET(makeRequest('Bearer wrong-secret'))

    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json).toEqual({ error: 'Unauthorized' })
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('returns 401 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))

    expect(res.status).toBe(401)
    expect(mockFindMany).not.toHaveBeenCalled()
  })

  it('processes due enrollments and returns results on a successful run', async () => {
    mockUpdateMany
      .mockResolvedValueOnce({ count: 0 }) // stale-lock recovery
      .mockResolvedValueOnce({ count: 1 }) // atomic claim of enroll-1
      .mockResolvedValueOnce({ count: 1 }) // atomic claim of enroll-2
    mockFindMany.mockResolvedValue([{ id: 'enroll-1' }, { id: 'enroll-2' }])
    mockUpdate.mockResolvedValue({})
    mockRunSequenceStep
      .mockResolvedValueOnce('DRAFT_GENERATED')
      .mockResolvedValueOnce('COMPLETED')

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({
      processed: 2,
      results: [
        { enrollmentId: 'enroll-1', result: 'DRAFT_GENERATED' },
        { enrollmentId: 'enroll-2', result: 'COMPLETED' },
      ],
      staleLockRecovery: true,
    })

    // stale-lock recovery query ran
    expect(mockUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ processing: true }),
        data: { processing: false, processingStartedAt: null },
      }),
    )
    // each claimed enrollment had its lock released
    expect(mockUpdate).toHaveBeenCalledTimes(2)
    expect(mockRunSequenceStep).toHaveBeenCalledWith({ enrollmentId: 'enroll-1' })
    expect(mockRunSequenceStep).toHaveBeenCalledWith({ enrollmentId: 'enroll-2' })
  })

  it('skips an enrollment that another instance has already claimed', async () => {
    mockUpdateMany
      .mockResolvedValueOnce({ count: 0 }) // stale-lock recovery
      .mockResolvedValueOnce({ count: 0 }) // claim fails — already taken
    mockFindMany.mockResolvedValue([{ id: 'enroll-1' }])

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.processed).toBe(0)
    expect(mockRunSequenceStep).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
