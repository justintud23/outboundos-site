import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    sequenceEnrollment: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    cronHeartbeat: { upsert: vi.fn() },
  },
}))

vi.mock('@/features/sequences/server/run-sequence-step', () => ({
  runSequenceStep: vi.fn(),
}))

vi.mock('@/features/verification/server/verify-leads', () => ({
  verifyPendingLeads: vi.fn(),
  VERIFY_BUDGET_MS: 10_000,
}))

import { prisma } from '@/lib/db/prisma'
import { runSequenceStep } from '@/features/sequences/server/run-sequence-step'
import { verifyPendingLeads } from '@/features/verification/server/verify-leads'
import { GET, maxDuration } from './route'

const mockUpdateMany = prisma.sequenceEnrollment.updateMany as ReturnType<typeof vi.fn>
const mockFindMany = prisma.sequenceEnrollment.findMany as ReturnType<typeof vi.fn>
const mockUpdate = prisma.sequenceEnrollment.update as ReturnType<typeof vi.fn>
const mockRunSequenceStep = runSequenceStep as ReturnType<typeof vi.fn>
const mockHeartbeat = prisma.cronHeartbeat.upsert as ReturnType<typeof vi.fn>
const mockVerify = verifyPendingLeads as ReturnType<typeof vi.fn>

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
  mockVerify.mockResolvedValue({ checked: 0, retried: 0, accountError: null, skipped: true })
})

afterEach(() => {
  delete process.env.CRON_SECRET
  vi.restoreAllMocks()
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
      verification: { checked: 0, retried: 0, accountError: null, skipped: true },
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

  it('allows 60s of function time (I7)', () => {
    expect(maxDuration).toBe(60)
  })

  it('stops starting new enrollments once the time budget is spent (I7)', async () => {
    const t0 = 1_000_000
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(t0) // startedAt
      .mockReturnValueOnce(t0 + 1_000) // before enroll-1: within budget
      .mockReturnValue(t0 + 26_000) // before enroll-2: over the 25s budget
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockFindMany.mockResolvedValue([{ id: 'enroll-1' }, { id: 'enroll-2' }])
    mockUpdate.mockResolvedValue({})
    mockRunSequenceStep.mockResolvedValue('DRAFT_GENERATED')

    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    const json = await res.json()

    expect(mockRunSequenceStep).toHaveBeenCalledTimes(1)
    expect(mockRunSequenceStep).toHaveBeenCalledWith({ enrollmentId: 'enroll-1' })
    expect(json).toMatchObject({ processed: 1, outOfBudget: true })
    expect(mockHeartbeat).toHaveBeenCalledWith(expect.objectContaining({
      where: { job: 'sequence-runner' },
      update: expect.objectContaining({ lastResult: { processed: 1, outOfBudget: true } }),
    }))
  })

  it('records the heartbeat even when the tick throws (I7)', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })
    mockFindMany.mockRejectedValue(new Error('db down'))

    await expect(GET(makeRequest(`Bearer ${CRON_SECRET}`))).rejects.toThrow('db down')
    expect(mockHeartbeat).toHaveBeenCalledWith(expect.objectContaining({ where: { job: 'sequence-runner' } }))
  })

  it('verifies pending leads with a 10 s budget before querying due enrollments', async () => {
    mockUpdateMany.mockResolvedValue({ count: 0 })
    mockFindMany.mockResolvedValue([])
    const order: string[] = []
    mockVerify.mockImplementation(async () => { order.push('verify'); return { checked: 2, retried: 0, accountError: null, skipped: false } })
    mockFindMany.mockImplementation(async () => { order.push('due'); return [] })
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    expect(mockVerify).toHaveBeenCalledWith(10_000)
    expect(order).toEqual(['verify', 'due'])
    expect((await res.json()).verification).toMatchObject({ checked: 2 })
  })

  it('still processes enrollments when verification throws', async () => {
    mockUpdateMany.mockResolvedValue({ count: 1 })
    mockFindMany.mockResolvedValue([{ id: 'e1' }])
    mockRunSequenceStep.mockResolvedValue('DRAFT_GENERATED')
    mockVerify.mockRejectedValue(new Error('db down'))
    const res = await GET(makeRequest(`Bearer ${CRON_SECRET}`))
    expect(res.status).toBe(200)
    expect(mockRunSequenceStep).toHaveBeenCalledWith({ enrollmentId: 'e1' })
  })
})
