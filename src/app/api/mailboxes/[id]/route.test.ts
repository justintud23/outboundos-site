import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}))

vi.mock('@/lib/auth/resolve-organization', () => ({
  resolveOrganization: vi.fn(),
}))

vi.mock('@/features/mailboxes/server/set-mailbox-ramp', () => ({
  setMailboxRampPreset: vi.fn(),
  restartMailboxRamp: vi.fn(),
}))

import { auth } from '@clerk/nextjs/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { setMailboxRampPreset, restartMailboxRamp } from '@/features/mailboxes/server/set-mailbox-ramp'
import { MailboxNotFoundError } from '@/features/mailboxes/types'
import { PATCH } from './route'

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>
const mockResolveOrganization = resolveOrganization as unknown as ReturnType<typeof vi.fn>
const mockSetMailboxRampPreset = setMailboxRampPreset as unknown as ReturnType<typeof vi.fn>
const mockRestartMailboxRamp = restartMailboxRamp as unknown as ReturnType<typeof vi.fn>

const fakeOrg = { id: 'internal-org-id', clerkId: 'clerk-org-id' }
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
})

describe('PATCH /api/mailboxes/[id] - ramp actions', () => {
  it('calls setMailboxRampPreset when rampPreset is provided', async () => {
    mockAuth.mockResolvedValue({ orgId: 'clerk-org-id' })
    mockResolveOrganization.mockResolvedValue(fakeOrg)
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
    mockAuth.mockResolvedValue({ orgId: 'clerk-org-id' })
    mockResolveOrganization.mockResolvedValue(fakeOrg)

    const req = makeRequest({ rampPreset: 'TURBO' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json).toHaveProperty('error')
    expect(mockSetMailboxRampPreset).not.toHaveBeenCalled()
  })

  it('calls restartMailboxRamp when restartRamp is true', async () => {
    mockAuth.mockResolvedValue({ orgId: 'clerk-org-id' })
    mockResolveOrganization.mockResolvedValue(fakeOrg)
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
    mockAuth.mockResolvedValue({ orgId: 'clerk-org-id' })
    mockResolveOrganization.mockResolvedValue(fakeOrg)
    mockSetMailboxRampPreset.mockRejectedValue(new MailboxNotFoundError())

    const req = makeRequest({ rampPreset: 'AGGRESSIVE' })
    const res = await PATCH(req, { params: Promise.resolve({ id: 'mb-1' }) })

    expect(res.status).toBe(404)
    const json = await res.json()
    expect(json.error).toBe('Mailbox not found.')
  })
})
