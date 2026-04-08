import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getSequence } from '@/features/sequences/server/get-sequence'
import { updateSequence } from '@/features/sequences/server/update-sequence'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { SequenceNotFoundError, SequenceHasActiveEnrollmentsError } from '@/features/sequences/types'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const org = await resolveOrganization(orgId)

  try {
    const sequence = await getSequence({ organizationId: org.id, sequenceId: id })
    return NextResponse.json(sequence)
  } catch (err) {
    if (err instanceof SequenceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    throw err
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const org = await resolveOrganization(orgId)

  let body: { name?: string; steps?: unknown[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const sequence = await updateSequence({
      organizationId: org.id,
      sequenceId: id,
      name: body.name,
      newSteps: body.steps as { stepNumber: number; subject: string; body: string; delayDays: number }[] | undefined,
    })
    return NextResponse.json(sequence)
  } catch (err) {
    if (err instanceof SequenceNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    if (err instanceof SequenceHasActiveEnrollmentsError) {
      return NextResponse.json({ error: err.message }, { status: 409 })
    }
    throw err
  }
}
