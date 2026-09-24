import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { createCampaign } from '@/features/campaigns/server/campaign-sending'

export async function POST(request: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { name?: unknown; description?: unknown } | null
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const org = await resolveOrganization(orgId)
  const campaign = await createCampaign({
    organizationId: org.id,
    name: body.name,
    description: typeof body.description === 'string' ? body.description : null,
  })
  return NextResponse.json(campaign, { status: 201 })
}
