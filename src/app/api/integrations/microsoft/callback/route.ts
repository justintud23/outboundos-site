import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { saveTenant, CONNECT_STATE_COOKIE } from '@/features/integrations/server/microsoft'

function settingsRedirect(request: Request, status: string) {
  return NextResponse.redirect(new URL(`/settings?microsoft=${status}`, request.url))
}

export async function GET(request: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const params = new URL(request.url).searchParams
  const jar = await cookies()
  const expected = jar.get(CONNECT_STATE_COOKIE)?.value
  jar.delete(CONNECT_STATE_COOKIE)

  if (!expected || params.get('state') !== expected) return settingsRedirect(request, 'state_mismatch')
  if (params.get('error') || params.get('admin_consent') !== 'True') return settingsRedirect(request, 'denied')

  const tenant = params.get('tenant')
  if (!tenant) return settingsRedirect(request, 'denied')

  try {
    const org = await resolveOrganization(orgId)
    await saveTenant(org.id, tenant)
  } catch (err) {
    console.error('[microsoft callback]', err)
    return settingsRedirect(request, 'error')
  }
  return settingsRedirect(request, 'connected')
}
