import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { updateLeadStatus } from '@/features/leads/server/update-lead-status'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
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
  const { orgId, userId } = await auth()

  if (!orgId || !userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: leadId } = await params

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

  const org = await resolveOrganization(orgId)

  try {
    const result = await updateLeadStatus({
      organizationId: org.id,
      leadId,
      newStatus: body.status,
      actorClerkId: userId,
    })

    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof LeadNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}
