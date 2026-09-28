import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { rescoreOrganizationLeads } from '@/features/business-profile/server/rescore'

export const maxDuration = 60

export async function POST(request: Request) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as { since?: unknown }
  let since: Date | undefined
  if (body.since !== undefined) {
    since = typeof body.since === 'string' ? new Date(body.since) : new Date(NaN)
    if (Number.isNaN(since.getTime())) return NextResponse.json({ error: 'Invalid since' }, { status: 400 })
  }
  try {
    return NextResponse.json(await rescoreOrganizationLeads(ctx.org.id, { since }))
  } catch (err) {
    console.error('[POST /api/settings/business-profile/rescore]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
