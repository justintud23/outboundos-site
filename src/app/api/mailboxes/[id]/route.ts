import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { setMailboxWarmup } from '@/features/mailboxes/server/set-mailbox-warmup'
import { resumeMailbox } from '@/features/mailboxes/server/resume-mailbox'
import { setMailboxRampPreset, restartMailboxRamp } from '@/features/mailboxes/server/set-mailbox-ramp'
import { MailboxNotFoundError } from '@/features/mailboxes/types'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params

  let body: { warmupEnabled?: unknown; resume?: unknown; rampPreset?: unknown; restartRamp?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    const org = await resolveOrganization(orgId)

    // Restart the ramp from day 1.
    if (body.restartRamp === true) {
      return NextResponse.json(await restartMailboxRamp({ organizationId: org.id, mailboxId: id }))
    }

    // Change the ramp preset schedule.
    if (body.rampPreset !== undefined) {
      if (body.rampPreset !== 'CONSERVATIVE' && body.rampPreset !== 'STANDARD' && body.rampPreset !== 'AGGRESSIVE') {
        return NextResponse.json({ error: 'rampPreset must be CONSERVATIVE, STANDARD or AGGRESSIVE' }, { status: 400 })
      }
      return NextResponse.json(await setMailboxRampPreset({ organizationId: org.id, mailboxId: id, rampPreset: body.rampPreset }))
    }

    // Resume: clear a circuit-breaker auto-pause (human-only; there is no auto-resume).
    if (body.resume === true) {
      const mailbox = await resumeMailbox({ organizationId: org.id, mailboxId: id })
      return NextResponse.json(mailbox)
    }

    if (typeof body.warmupEnabled === 'boolean') {
      const mailbox = await setMailboxWarmup({
        organizationId: org.id,
        mailboxId: id,
        warmupEnabled: body.warmupEnabled,
      })
      return NextResponse.json(mailbox)
    }

    return NextResponse.json(
      { error: 'Provide warmupEnabled (boolean), resume: true, restartRamp: true, or rampPreset (CONSERVATIVE, STANDARD, AGGRESSIVE)' },
      { status: 400 },
    )
  } catch (err) {
    if (err instanceof MailboxNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    console.error('[PATCH /api/mailboxes/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
