import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { rescoreOrganizationLeads } from '@/features/business-profile/server/rescore'

export const maxDuration = 60

export async function POST(request: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const body = (await request.json().catch(() => ({}))) as { since?: unknown }
  let since: Date | undefined
  if (body.since !== undefined) {
    since = typeof body.since === 'string' ? new Date(body.since) : new Date(NaN)
    if (Number.isNaN(since.getTime())) return NextResponse.json({ error: 'Invalid since' }, { status: 400 })
  }
  try {
    const org = await resolveOrganization(orgId)
    return NextResponse.json(await rescoreOrganizationLeads(org.id, { since }))
  } catch (err) {
    console.error('[POST /api/settings/business-profile/rescore]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
