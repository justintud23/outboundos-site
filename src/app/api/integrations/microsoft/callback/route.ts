import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { saveTenant, CONNECT_STATE_COOKIE, TenantMismatchError } from '@/features/integrations/server/microsoft'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'

function settingsRedirect(request: Request, status: string) {
  return NextResponse.redirect(new URL(`/settings?microsoft=${status}`, request.url))
}

export async function GET(request: Request) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  const params = new URL(request.url).searchParams
  const jar = await cookies()
  const expected = jar.get(CONNECT_STATE_COOKIE)?.value
  jar.delete(CONNECT_STATE_COOKIE)

  if (!expected || params.get('state') !== expected) return settingsRedirect(request, 'state_mismatch')
  if (params.get('error') || params.get('admin_consent') !== 'True') return settingsRedirect(request, 'denied')

  const tenant = params.get('tenant')
  if (!tenant) return settingsRedirect(request, 'denied')

  try {
    await saveTenant(ctx.org.id, tenant)
  } catch (err) {
    console.error('[microsoft callback]', err)
    if (err instanceof TenantMismatchError) return settingsRedirect(request, 'tenant_mismatch')
    return settingsRedirect(request, 'error')
  }
  return settingsRedirect(request, 'connected')
}
