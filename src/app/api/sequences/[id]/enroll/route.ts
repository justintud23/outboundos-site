import { NextResponse } from 'next/server'
import { enrollLead } from '@/features/sequences/server/enroll-lead'
import { resolveMember } from '@/lib/auth/resolve-member'
import { getSequenceOwnerId } from '@/features/team/server/owners'
import { denyUnlessCanAct } from '@/lib/auth/permission-response'
import { LeadInTerminalStateError, LeadExcludedCanadaError } from '@/features/leads/types'
import { AlreadyEnrolledError, SequenceHasNoStepsError } from '@/features/sequences/types'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: sequenceId } = await params

  const denied = denyUnlessCanAct(ctx, await getSequenceOwnerId(ctx.org.id, sequenceId))
  if (denied) return denied

  let body: { leadIds?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ error: 'leadIds array is required' }, { status: 400 })
  }

  const results: { leadId: string; success: boolean; error?: string; enrollmentId?: string }[] = []

  for (const leadId of body.leadIds) {
    try {
      const enrollment = await enrollLead({
        organizationId: ctx.org.id,
        sequenceId,
        leadId,
        actorClerkId: ctx.member.clerkUserId,
      })
      results.push({ leadId, success: true, enrollmentId: enrollment.id })
    } catch (err) {
      if (err instanceof LeadInTerminalStateError) {
        results.push({ leadId, success: false, error: 'Lead is in terminal state' })
      } else if (err instanceof LeadExcludedCanadaError) {
        results.push({ leadId, success: false, error: `Excluded: Canada (CASL) — ${err.reason}` })
      } else if (err instanceof AlreadyEnrolledError) {
        results.push({ leadId, success: false, error: 'Already enrolled' })
      } else if (err instanceof SequenceHasNoStepsError) {
        results.push({ leadId, success: false, error: 'Sequence has no steps' })
      } else {
        results.push({ leadId, success: false, error: 'Failed to enroll' })
      }
    }
  }

  const successCount = results.filter((r) => r.success).length
  return NextResponse.json({ results, enrolled: successCount, total: body.leadIds.length }, { status: 201 })
}
