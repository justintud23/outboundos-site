import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getCampaignOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'
import { updateCampaignSending, CampaignNotFoundError } from '@/features/campaigns/server/campaign-sending'
import { ContentHighRiskError } from '@/features/content-check/types'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params

  const denied = denyUnlessCanAct(ctx, await getCampaignOwnerId(ctx.org.id, id))
  if (denied) return denied

  const body = (await request.json().catch(() => null)) as { autoSend?: unknown; sampleSize?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (body.autoSend !== undefined && typeof body.autoSend !== 'boolean') {
    return NextResponse.json({ error: 'autoSend must be a boolean' }, { status: 400 })
  }
  if (body.sampleSize !== undefined && (typeof body.sampleSize !== 'number' || !Number.isFinite(body.sampleSize))) {
    return NextResponse.json({ error: 'sampleSize must be a number' }, { status: 400 })
  }

  try {
    const updated = await updateCampaignSending({
      organizationId: ctx.org.id,
      campaignId: id,
      autoSend: body.autoSend as boolean | undefined,
      sampleSize: body.sampleSize as number | undefined,
    })
    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof CampaignNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 })
    if (err instanceof ContentHighRiskError) {
      return NextResponse.json({ code: 'CONTENT_HIGH_RISK', error: err.message, findings: err.items }, { status: 422 })
    }
    throw err
  }
}
