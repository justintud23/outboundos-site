import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { resolveMember } from '@/lib/auth/resolve-member'
import { loginHostFor } from '@/features/salesforce/config'
import { verifyState, exchangeCode, fetchIdentity, SF_PKCE_COOKIE, SF_PKCE_COOKIE_PATH } from '@/features/salesforce/server/oauth'
import { saveConnection } from '@/features/salesforce/server/connection'

function settingsError(request: Request, reason: string) {
  return NextResponse.redirect(new URL(`/settings?salesforce=error&reason=${reason}`, request.url))
}

export async function GET(request: Request) {
  const jar = await cookies()

  const fail = (reason: string) => {
    jar.delete({ name: SF_PKCE_COOKIE, path: SF_PKCE_COOKIE_PATH })
    return settingsError(request, reason)
  }

  const params = new URL(request.url).searchParams
  if (params.get('error')) return fail('denied')

  const ctx = await resolveMember()
  if (!ctx || !ctx.isAdmin) return fail('not_admin')

  const state = verifyState(params.get('state') ?? '')
  if (!state || state.orgId !== ctx.org.id || state.memberId !== ctx.member.id) return fail('state')

  const verifier = jar.get(SF_PKCE_COOKIE)?.value
  if (!verifier) return fail('pkce')

  try {
    const code = params.get('code') ?? ''
    const { accessToken, refreshToken, instanceUrl, idUrl } = await exchangeCode({ env: state.env, code, verifier })
    const identity = await fetchIdentity(idUrl, accessToken)
    const { orgChanged } = await saveConnection(ctx.org.id, ctx.member.id, {
      instanceUrl,
      loginHost: loginHostFor(state.env),
      sfOrgId: identity.orgId,
      sfUserId: identity.userId,
      sfUsername: identity.username,
      sfUserEmail: identity.email,
      refreshToken,
    })
    jar.delete({ name: SF_PKCE_COOKIE, path: SF_PKCE_COOKIE_PATH })
    return NextResponse.redirect(
      new URL(`/settings?salesforce=${orgChanged ? 'connected_new_org' : 'connected'}`, request.url),
    )
  } catch (err) {
    console.error('[salesforce callback]', err)
    return fail('exchange')
  }
}
