import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { updateCampaignSending, CampaignNotFoundError } from '@/features/campaigns/server/campaign-sending'

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params

  const body = (await request.json().catch(() => null)) as { autoSend?: unknown; sampleSize?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (body.autoSend !== undefined && typeof body.autoSend !== 'boolean') {
    return NextResponse.json({ error: 'autoSend must be a boolean' }, { status: 400 })
  }
  if (body.sampleSize !== undefined && (typeof body.sampleSize !== 'number' || !Number.isFinite(body.sampleSize))) {
    return NextResponse.json({ error: 'sampleSize must be a number' }, { status: 400 })
  }

  try {
    const org = await resolveOrganization(orgId)
    const updated = await updateCampaignSending({
      organizationId: org.id,
      campaignId: id,
      autoSend: body.autoSend as boolean | undefined,
      sampleSize: body.sampleSize as number | undefined,
    })
    return NextResponse.json(updated)
  } catch (err) {
    if (err instanceof CampaignNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 })
    throw err
  }
}
