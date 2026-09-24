import { randomBytes } from 'node:crypto'
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { buildAdminConsentUrl, CONNECT_STATE_COOKIE } from '@/features/integrations/server/microsoft'

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const state = randomBytes(24).toString('base64url')
  const res = NextResponse.redirect(buildAdminConsentUrl(state))
  res.cookies.set(CONNECT_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
