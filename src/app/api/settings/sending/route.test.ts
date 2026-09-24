import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(),
}))

vi.mock('@/lib/auth/resolve-organization', () => ({
  resolveOrganization: vi.fn(),
}))

vi.mock('@/features/settings/server/sending-settings', async () => {
  const actual = await vi.importActual<typeof import('@/features/settings/server/sending-settings')>(
    '@/features/settings/server/sending-settings',
  )
  return {
    ...actual,
    getSendingSettings: vi.fn(),
    updateSendingSettings: vi.fn(),
  }
})

import { auth } from '@clerk/nextjs/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getSendingSettings, updateSendingSettings, SettingsValidationError } from '@/features/settings/server/sending-settings'
import { GET, PATCH } from './route'

const mockAuth = auth as unknown as ReturnType<typeof vi.fn>
const mockResolveOrganization = resolveOrganization as unknown as ReturnType<typeof vi.fn>
const mockGetSendingSettings = getSendingSettings as unknown as ReturnType<typeof vi.fn>
const mockUpdateSendingSettings = updateSendingSettings as unknown as ReturnType<typeof vi.fn>

const org = { id: 'internal-org-id', clerkId: 'clerk-org-id' }

const dto = {
  timezone: 'America/New_York',
  businessHoursStart: 8,
  businessHoursEnd: 17,
  sendDays: [1, 2, 3, 4, 5],
  escalationEmail: null,
  sendingPaused: false,
  pausedReason: null,
  guardrailBlockedPhrases: [],
  guardrailAllowedWords: [],
  msConnected: false,
}

function patchRequest(body: unknown) {
  return new Request('http://localhost/api/settings/sending', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth.mockResolvedValue({ orgId: 'clerk-org-id' })
  mockResolveOrganization.mockResolvedValue(org)
})

describe('GET /api/settings/sending', () => {
  it('returns 403 when there is no active organization', async () => {
    mockAuth.mockResolvedValue({ orgId: null })

    const res = await GET()

    expect(res.status).toBe(403)
    expect(mockGetSendingSettings).not.toHaveBeenCalled()
  })

  it('returns the settings DTO', async () => {
    mockGetSendingSettings.mockResolvedValue(dto)

    const res = await GET()

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(dto)
  })
})

describe('PATCH /api/settings/sending', () => {
  it('returns 403 when there is no active organization', async () => {
    mockAuth.mockResolvedValue({ orgId: null })

    const res = await PATCH(patchRequest({ sendingPaused: true }))

    expect(res.status).toBe(403)
    expect(mockUpdateSendingSettings).not.toHaveBeenCalled()
  })

  it('returns 400 when a known field has the wrong type', async () => {
    const res = await PATCH(patchRequest({ businessHoursStart: 'eight' }))

    expect(res.status).toBe(400)
    expect(mockUpdateSendingSettings).not.toHaveBeenCalled()
  })

  it('returns 400 when updateSendingSettings throws SettingsValidationError', async () => {
    mockUpdateSendingSettings.mockRejectedValue(new SettingsValidationError('Unknown timezone'))

    const res = await PATCH(patchRequest({ timezone: 'Mars/Olympus' }))

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'Unknown timezone' })
  })

  it('returns 200 with the updated DTO on a valid PATCH', async () => {
    mockUpdateSendingSettings.mockResolvedValue({ ...dto, sendingPaused: true, pausedReason: 'Paused manually from Settings.' })

    const res = await PATCH(patchRequest({ sendingPaused: true }))

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ...dto, sendingPaused: true, pausedReason: 'Paused manually from Settings.' })
    expect(mockUpdateSendingSettings).toHaveBeenCalledWith('internal-org-id', { sendingPaused: true })
  })
})
