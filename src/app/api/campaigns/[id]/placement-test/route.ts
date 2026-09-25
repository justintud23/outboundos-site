import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { sendPlacementTest, PlacementTestError } from '@/features/placement-test/server/send-placement-test'

export const maxDuration = 60

interface PlacementTestBody {
  sequenceId?: unknown
  mailboxId?: unknown
  leadId?: unknown
  seeds?: unknown
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId, userId } = await auth()
  if (!orgId || !userId) {
    return NextResponse.json({ error: 'No active organization. Select an organization to continue.' }, { status: 403 })
  }

  const { id: campaignId } = await params
  const body = (await request.json().catch(() => null)) as PlacementTestBody | null

  if (
    !body ||
    typeof body.sequenceId !== 'string' ||
    typeof body.mailboxId !== 'string' ||
    !Array.isArray(body.seeds) ||
    !body.seeds.every((s) => typeof s === 'string') ||
    (body.leadId !== undefined && body.leadId !== null && typeof body.leadId !== 'string')
  ) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }

  try {
    const org = await resolveOrganization(orgId)
    const result = await sendPlacementTest({
      organizationId: org.id,
      campaignId,
      sequenceId: body.sequenceId,
      mailboxId: body.mailboxId,
      leadId: (body.leadId as string | null | undefined) ?? null,
      seeds: body.seeds as string[],
      clerkUserId: userId,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof PlacementTestError) {
      const status = err.code === 'INVALID_SEEDS' ? 400 : err.code === 'NOT_FOUND' ? 404 : err.code === 'NO_CAPACITY' ? 429 : 422
      return NextResponse.json({ code: err.code, error: err.message }, { status })
    }
    console.error('[POST /api/campaigns/[id]/placement-test]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
