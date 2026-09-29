import { NextResponse } from 'next/server'
import { updateLeadStatus } from '@/features/leads/server/update-lead-status'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getLeadOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'
import { LeadNotFoundError } from '@/features/leads/types'

const VALID_STATUSES = [
  'NEW', 'CONTACTED', 'REPLIED', 'INTERESTED', 'CONVERTED',
  'NOT_INTERESTED', 'UNSUBSCRIBED', 'BOUNCED',
] as const

type ValidStatus = (typeof VALID_STATUSES)[number]

function isValidStatus(s: string): s is ValidStatus {
  return (VALID_STATUSES as readonly string[]).includes(s)
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveMember()

  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: leadId } = await params

  const denied = denyUnlessCanAct(ctx, await getLeadOwnerId(ctx.org.id, leadId))
  if (denied) return denied

  let body: { status?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.status || !isValidStatus(body.status)) {
    return NextResponse.json(
      { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const result = await updateLeadStatus({
      organizationId: ctx.org.id,
      leadId,
      newStatus: body.status,
      actorClerkId: ctx.member.clerkUserId,
    })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof LeadNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
