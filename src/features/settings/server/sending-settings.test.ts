import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: { organization: { findUniqueOrThrow: vi.fn(), update: vi.fn() } } }))

import { prisma } from '@/lib/db/prisma'
import { updateSendingSettings, SettingsValidationError } from './sending-settings'

const row = {
  timezone: 'America/New_York', businessHoursStart: 8, businessHoursEnd: 17, sendDays: [1, 2, 3, 4, 5],
  escalationEmail: null, sendingPaused: false, pausedReason: null, guardrailBlockedPhrases: [], guardrailAllowedWords: [], msTenantId: null,
}
beforeEach(() => {
  vi.resetAllMocks()
  ;(prisma.organization.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(row)
  ;(prisma.organization.update as ReturnType<typeof vi.fn>).mockResolvedValue(row)
})

describe('updateSendingSettings', () => {
  it.each([
    [{ timezone: 'Mars/Olympus' }, /timezone/],
    [{ businessHoursStart: 17, businessHoursEnd: 8 }, /hours/],
    [{ businessHoursStart: -1 }, /hours/],
    [{ sendDays: [] }, /day/],
    [{ sendDays: [7] }, /day/],
    [{ escalationEmail: 'nope' }, /email/],
  ])('rejects %o', async (patch, msg) => {
    await expect(updateSendingSettings('org-1', patch)).rejects.toThrow(msg)
    await expect(updateSendingSettings('org-1', patch)).rejects.toBeInstanceOf(SettingsValidationError)
  })

  it('un-pausing clears pausedReason; phrases are trimmed and de-duplicated', async () => {
    await updateSendingSettings('org-1', { sendingPaused: false, guardrailBlockedPhrases: [' Cheapest ', 'cheapest', ''] })
    expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { sendingPaused: false, pausedReason: null, guardrailBlockedPhrases: ['cheapest'] },
    }))
  })

  it('manual pause records a reason', async () => {
    await updateSendingSettings('org-1', { sendingPaused: true })
    expect((prisma.organization.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data).toEqual({
      sendingPaused: true,
      pausedReason: 'Paused manually from Settings.',
    })
  })
})
