import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/auth/resolve-member', () => ({ resolveMember: vi.fn() }))

vi.mock('@/features/mailboxes/server/set-mailbox-ramp', () => ({
  setMailboxRampPreset: vi.fn(),
  restartMailboxRamp: vi.fn(),
}))

import { resolveMember } from '@/lib/auth/resolve-member'
import { setMailboxRampPreset, restartMailboxRamp } from '@/features/mailboxes/server/set-mailbox-ramp'
import { MailboxNotFoundError } from '@/features/mailboxes/types'
import { PATCH } from './route'

const mockResolveMember = resolveMember as unknown as ReturnType<typeof vi.fn>
const mockSetMailboxRampPreset = setMailboxRampPreset as unknown as ReturnType<typeof vi.fn>
const mockRestartMailboxRamp = restartMailboxRamp as unknown as ReturnType<typeof vi.fn>

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
