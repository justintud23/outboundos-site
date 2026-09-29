import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { getSalesforceAppConfig } from '@/features/salesforce/config'
import { createPkcePair, signState, buildAuthorizeUrl, SF_PKCE_COOKIE } from '@/features/salesforce/server/oauth'
import type { SfEnv } from '@/features/salesforce/config'

function parseEnv(value: string | null): SfEnv {
  return value === 'sandbox' ? 'sandbox' : 'production'
}

export async function GET(request: Request) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  if (!getSalesforceAppConfig()) {
    return NextResponse.redirect(new URL('/settings?salesforce=error&reason=not_configured', request.url))
  }

  const env = parseEnv(new URL(request.url).searchParams.get('env'))
  const { verifier, challenge } = createPkcePair()
  const state = signState({ orgId: ctx.org.id, memberId: ctx.member.id, env })

  const res = NextResponse.redirect(buildAuthorizeUrl({ env, state, challenge }))
  res.cookies.set(SF_PKCE_COOKIE, verifier, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/integrations/salesforce',
  })
  return res
}
