import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import {
  getSendingSettings,
  updateSendingSettings,
  SettingsValidationError,
  type SendingSettingsPatch,
} from '@/features/settings/server/sending-settings'

const STRING_FIELDS = new Set(['timezone', 'escalationEmail'])
const NUMBER_FIELDS = new Set(['businessHoursStart', 'businessHoursEnd'])
const BOOLEAN_FIELDS = new Set(['sendingPaused'])
const STRING_ARRAY_FIELDS = new Set(['sendDays', 'guardrailBlockedPhrases', 'guardrailAllowedWords'])

function isValidValue(key: string, value: unknown): boolean {
  if (STRING_FIELDS.has(key)) return typeof value === 'string' || value === null
  if (NUMBER_FIELDS.has(key)) return typeof value === 'number'
  if (BOOLEAN_FIELDS.has(key)) return typeof value === 'boolean'
  if (STRING_ARRAY_FIELDS.has(key)) {
    if (!Array.isArray(value)) return false
    if (key === 'sendDays') return value.every((v) => typeof v === 'number')
    return value.every((v) => typeof v === 'string')
  }
  return false
}

const KNOWN_FIELDS = new Set([...STRING_FIELDS, ...NUMBER_FIELDS, ...BOOLEAN_FIELDS, ...STRING_ARRAY_FIELDS])

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization. Select an organization to continue.' }, { status: 403 })

  const org = await resolveOrganization(orgId)
  const settings = await getSendingSettings(org.id)
  return NextResponse.json(settings)
}

export async function PATCH(request: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization. Select an organization to continue.' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (!KNOWN_FIELDS.has(key)) continue
    if (!isValidValue(key, value)) {
      return NextResponse.json({ error: `Invalid value for ${key}` }, { status: 400 })
    }
    patch[key] = value
  }

  try {
    const org = await resolveOrganization(orgId)
    const settings = await updateSendingSettings(org.id, patch as SendingSettingsPatch)
    return NextResponse.json(settings)
  } catch (err) {
    if (err instanceof SettingsValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    console.error('[PATCH /api/settings/sending]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
