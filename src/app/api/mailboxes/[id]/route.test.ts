import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))

vi.mock('@/features/mailboxes/server/set-mailbox-ramp', () => ({
  setMailboxRampPreset: vi.fn(),
  restartMailboxRamp: vi.fn(),
}))

vi.mock('@/features/team/server/assign-owner', () => ({
  assignOwner: vi.fn(),
  InvalidOwnerError: class InvalidOwnerError extends Error {},
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: { mailbox: { findUniqueOrThrow: vi.fn() } },
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { setMailboxRampPreset, restartMailboxRamp } from '@/features/mailboxes/server/set-mailbox-ramp'
import { assignOwner, InvalidOwnerError } from '@/features/team/server/assign-owner'
import { prisma } from '@/lib/db/prisma'
import { MailboxNotFoundError } from '@/features/mailboxes/types'
import { PATCH } from './route'

const mockResolveMember = resolveMember as unknown as ReturnType<typeof vi.fn>
const mockSetMailboxRampPreset = setMailboxRampPreset as unknown as ReturnType<typeof vi.fn>
const mockRestartMailboxRamp = restartMailboxRamp as unknown as ReturnType<typeof vi.fn>
const mockAssignOwner = assignOwner as unknown as ReturnType<typeof vi.fn>
const mockFindUniqueOrThrow = prisma.mailbox.findUniqueOrThrow as unknown as ReturnType<typeof vi.fn>

const rep = { org: { id: 'internal-org-id' }, member: { id: 'm-rep', clerkUserId: 'user_rep' }, isAdmin: false }
const admin = { org: { id: 'internal-org-id' }, member: { id: 'm-admin', clerkUserId: 'user_admin' }, isAdmin: true }

const fakeMailboxDTO = {
  id: 'mb-1',
  organizationId: 'internal-org-id',
  email: 'a@x.com',
  displayName: 'A',
  isActive: true,
  dailyLimit: 30,
  sentToday: 0,
  warmupEnabled: true,
  effectiveDailyLimit: 10,
  warmupDay: 2,
  isWarmingUp: true,
  rampPreset: 'STANDARD',
  autoPaused: false,
  pausedAt: null,
  pauseReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const fakeMailboxRow = {
  id: 'mb-1',
  organizationId: 'internal-org-id',
  ownerId: null as string | null,
  email: 'a@x.com',
  displayName: 'A',
  isActive: true,
  dailyLimit: 50,
  sentToday: 0,
  warmupEnabled: false,
  warmupStartedAt: new Date('2026-01-01'),
  rampPreset: 'STANDARD',
  autoPaused: false,
  pausedAt: null,
  pauseReason: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/mailboxes/mb-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveMember.mockResolvedValue(admin as never)
  mockAssignOwner.mockResolvedValue(true)
  mockFindUniqueOrThrow.mockResolvedValue(fakeMailboxRow)
})

describe('PATCH /api/mailboxes/[id] - guard', () => {
  it('401 without an active org', async () => {
    mockResolveMember.mockResolvedValue(null)
    const res = await PATCH(makeRequest({ rampPreset: 'AGGRESSIVE' }), { params: Promise.resolve({ id: 'mb-1' }) })
    expect(res.status).toBe(401)
    expect(mockSetMailboxRampPreset).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member, and does not call the server function', async () => {
    mockResolveMember.mockResolvedValue(rep as never)
    const res = await PATCH(makeRequest({ rampPreset: 'AGGRESSIVE' }), { params: Promise.resolve({ id: 'mb-1' }) })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('ADMIN_ONLY')
    expect(mockSetMailboxRampPreset).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/mailboxes/[id] - ramp actions', () => {
  it('calls setMailboxRampPreset when rampPreset is provided', async () => {
    const updated = { ...fakeMailboxDTO, rampPreset: 'AGGRESSIVE' }
    mockSetMailboxRampPreset.mockResolvedValue(updated)

    const req = makeRequest({ rampPreset: 'AGGRESSIVE' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.rampPreset).toBe('AGGRESSIVE')
    expect(mockSetMailboxRampPreset).toHaveBeenCalledWith({
      organizationId: 'internal-org-id',
      mailboxId: 'mb-1',
      rampPreset: 'AGGRESSIVE',
    })
  })

  it('returns 400 when rampPreset is invalid', async () => {
    const req = makeRequest({ rampPreset: 'TURBO' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toHaveProperty('error')
    expect(mockSetMailboxRampPreset).not.toHaveBeenCalled()
  })

  it('calls restartMailboxRamp when restartRamp is true', async () => {
    mockRestartMailboxRamp.mockResolvedValue(fakeMailboxDTO)

    const req = makeRequest({ restartRamp: true })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.id).toBe('mb-1')
    expect(mockRestartMailboxRamp).toHaveBeenCalledWith({
      organizationId: 'internal-org-id',
      mailboxId: 'mb-1',
    })
  })

  it('returns 404 when MailboxNotFoundError is thrown', async () => {
    mockSetMailboxRampPreset.mockRejectedValue(new MailboxNotFoundError())

    const req = makeRequest({ rampPreset: 'AGGRESSIVE' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Mailbox not found.')
  })
})

describe('PATCH /api/mailboxes/[id] - ownerId', () => {
  it('assigns the given owner and returns the updated mailbox', async () => {
    mockFindUniqueOrThrow.mockResolvedValue({ ...fakeMailboxRow, ownerId: 'm-2' })

    const req = makeRequest({ ownerId: 'm-2' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(200)
    expect(mockAssignOwner).toHaveBeenCalledWith('internal-org-id', 'mailbox', 'mb-1', 'm-2')
    const json = await res.json()
    expect(json.id).toBe('mb-1')
  })

  it('unassigns with ownerId: null', async () => {
    const req = makeRequest({ ownerId: null })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(200)
    expect(mockAssignOwner).toHaveBeenCalledWith('internal-org-id', 'mailbox', 'mb-1', null)
  })

  it('returns 404 when assignOwner finds no matching mailbox in this org', async () => {
    mockAssignOwner.mockResolvedValue(false)

    const req = makeRequest({ ownerId: 'm-2' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(404)
  })

  it('returns 400 when ownerId is not a member of the org', async () => {
    mockAssignOwner.mockRejectedValue(new InvalidOwnerError())

    const req = makeRequest({ ownerId: 'm-bad' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(400)
  })

  it('returns 400 when ownerId is neither a string nor null', async () => {
    const req = makeRequest({ ownerId: 42 })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(400)
    expect(mockAssignOwner).not.toHaveBeenCalled()
  })

  it('403 ADMIN_ONLY for a non-admin member', async () => {
    mockResolveMember.mockResolvedValue(rep as never)
    const req = makeRequest({ ownerId: 'm-2' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(403)
    expect(mockAssignOwner).not.toHaveBeenCalled()
  })
})
