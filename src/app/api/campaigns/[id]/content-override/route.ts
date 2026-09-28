import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getCampaignOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'
import { recordContentOverride } from '@/features/content-check/server/content-gate'
import { ContentOverrideValidationError } from '@/features/content-check/types'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params

  const denied = denyUnlessCanAct(ctx, await getCampaignOwnerId(ctx.org.id, id))
  if (denied) return denied

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
  if (!body || typeof body.reason !== 'string') return NextResponse.json({ error: 'reason is required' }, { status: 400 })

  try {
    const status = await recordContentOverride({ organizationId: ctx.org.id, campaignId: id, clerkUserId: ctx.member.clerkUserId, reason: body.reason })
    if (!status) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    return NextResponse.json(status)
  } catch (err) {
    if (err instanceof ContentOverrideValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[POST /api/campaigns/[id]/content-override]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
