import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { getBusinessProfile, saveBusinessProfile, ProfileValidationError } from '@/features/business-profile/server/profile'

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const org = await resolveOrganization(orgId)
  return NextResponse.json({ profile: await getBusinessProfile(org.id) })
}

export async function PUT(request: Request) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  const body: unknown = await request.json().catch(() => undefined)
  if (body === undefined) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  try {
    return NextResponse.json({ profile: await saveBusinessProfile(ctx.org.id, body) })
  } catch (err) {
    if (err instanceof ProfileValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[PUT /api/settings/business-profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
