import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { buildAdminConsentUrl, CONNECT_STATE_COOKIE } from '@/features/integrations/server/microsoft'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'

export async function GET() {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied
  const state = randomBytes(24).toString('base64url')
  const res = NextResponse.redirect(buildAdminConsentUrl(state))
  res.cookies.set(CONNECT_STATE_COOKIE, state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' })
  return res
}
