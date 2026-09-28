import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getCampaignOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'
import { approveCampaignSample, CampaignNotFoundError } from '@/features/campaigns/server/campaign-sending'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params

  const denied = denyUnlessCanAct(ctx, await getCampaignOwnerId(ctx.org.id, id))
  if (denied) return denied

  try {
    const result = await approveCampaignSample({ organizationId: ctx.org.id, campaignId: id, clerkUserId: ctx.member.clerkUserId })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof CampaignNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 })
    throw err
  }
}
