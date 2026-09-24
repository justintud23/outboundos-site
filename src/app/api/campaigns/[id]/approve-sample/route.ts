import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { approveCampaignSample, CampaignNotFoundError } from '@/features/campaigns/server/campaign-sending'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params
  try {
    const org = await resolveOrganization(orgId)
    const result = await approveCampaignSample({ organizationId: org.id, campaignId: id, clerkUserId: userId })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof CampaignNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 })
    throw err
  }
}
