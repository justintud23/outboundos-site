import { prisma } from '@/lib/db/prisma'
import { isValidTimezone } from '@/features/messages/send-window'

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SettingsValidationError'
    Object.setPrototypeOf(this, SettingsValidationError.prototype)
  }
}

export interface SendingSettingsDTO {
  timezone: string
  businessHoursStart: number
  businessHoursEnd: number
  sendDays: number[]
  escalationEmail: string | null
  sendingPaused: boolean
  pausedReason: string | null
  guardrailBlockedPhrases: string[]
  guardrailAllowedWords: string[]
  msConnected: boolean
}

export type SendingSettingsPatch = Partial<Omit<SendingSettingsDTO, 'pausedReason' | 'msConnected'>>

const SELECT = {
  timezone: true, businessHoursStart: true, businessHoursEnd: true, sendDays: true, escalationEmail: true,
  sendingPaused: true, pausedReason: true, guardrailBlockedPhrases: true, guardrailAllowedWords: true, msTenantId: true,
} as const

function toDTO(o: { msTenantId: string | null } & Omit<SendingSettingsDTO, 'msConnected'>): SendingSettingsDTO {
  const { msTenantId, ...rest } = o
  return { ...rest, msConnected: !!msTenantId }
}

function cleanList(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim().toLowerCase()).filter(Boolean))]
}

export async function getSendingSettings(organizationId: string): Promise<SendingSettingsDTO> {
  return toDTO(await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: SELECT }))
}

export async function updateSendingSettings(organizationId: string, patch: SendingSettingsPatch): Promise<SendingSettingsDTO> {
  const data: Record<string, unknown> = {}

  if (patch.timezone !== undefined) {
    if (!isValidTimezone(patch.timezone)) throw new SettingsValidationError('Unknown timezone')
    data.timezone = patch.timezone
  }
  if (patch.businessHoursStart !== undefined || patch.businessHoursEnd !== undefined) {
    // Validate against the stored value for whichever side isn't being changed.
    const current = await prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { businessHoursStart: true, businessHoursEnd: true },
    })
    const start = patch.businessHoursStart ?? current.businessHoursStart
    const end = patch.businessHoursEnd ?? current.businessHoursEnd
    const valid = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end <= 24 && start < end
    if (!valid) throw new SettingsValidationError('Business hours must be whole hours with start before end (0–24)')
    if (patch.businessHoursStart !== undefined) data.businessHoursStart = start
    if (patch.businessHoursEnd !== undefined) data.businessHoursEnd = end
  }
  if (patch.sendDays !== undefined) {
    const days = [...new Set(patch.sendDays)].sort()
    if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new SettingsValidationError('Pick at least one send day (0=Sun … 6=Sat)')
    }
    data.sendDays = days
  }
  if (patch.escalationEmail !== undefined) {
    const email = patch.escalationEmail?.trim() || null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SettingsValidationError('Invalid escalation email')
    data.escalationEmail = email
  }
  if (patch.sendingPaused !== undefined) {
    data.sendingPaused = patch.sendingPaused
    data.pausedReason = patch.sendingPaused ? 'Paused manually from Settings.' : null
  }
  if (patch.guardrailBlockedPhrases !== undefined) data.guardrailBlockedPhrases = cleanList(patch.guardrailBlockedPhrases)
  if (patch.guardrailAllowedWords !== undefined) data.guardrailAllowedWords = cleanList(patch.guardrailAllowedWords)

  return toDTO(await prisma.organization.update({ where: { id: organizationId }, data, select: SELECT }))
}
