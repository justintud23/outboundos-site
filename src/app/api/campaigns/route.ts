import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { createCampaign } from '@/features/campaigns/server/campaign-sending'

export async function POST(request: Request) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const body = (await request.json().catch(() => null)) as { name?: unknown; description?: unknown } | null
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  const campaign = await createCampaign({
    organizationId: ctx.org.id,
    name: body.name,
    description: typeof body.description === 'string' ? body.description : null,
    ownerId: ctx.member.id,
  })
  return NextResponse.json(campaign, { status: 201 })
}
