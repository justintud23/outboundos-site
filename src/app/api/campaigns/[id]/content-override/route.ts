import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { recordContentOverride } from '@/features/content-check/server/content-gate'
import { ContentOverrideValidationError } from '@/features/content-check/types'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params

  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
  if (!body || typeof body.reason !== 'string') return NextResponse.json({ error: 'reason is required' }, { status: 400 })

  try {
    const org = await resolveOrganization(orgId)
    const status = await recordContentOverride({ organizationId: org.id, campaignId: id, clerkUserId: userId, reason: body.reason })
    if (!status) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    return NextResponse.json(status)
  } catch (err) {
    if (err instanceof ContentOverrideValidationError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[POST /api/campaigns/[id]/content-override]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
