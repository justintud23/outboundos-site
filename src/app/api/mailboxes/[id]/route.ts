import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { setMailboxWarmup } from '@/features/mailboxes/server/set-mailbox-warmup'
import { resumeMailbox } from '@/features/mailboxes/server/resume-mailbox'
import { setMailboxRampPreset, restartMailboxRamp } from '@/features/mailboxes/server/set-mailbox-ramp'
import { MailboxNotFoundError } from '@/features/mailboxes/types'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  const { id } = await params

  let body: { warmupEnabled?: unknown; resume?: unknown; rampPreset?: unknown; restartRamp?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  try {
    // Restart the ramp from day 1.
    if (body.restartRamp === true) {
      return NextResponse.json(await restartMailboxRamp({ organizationId: ctx.org.id, mailboxId: id }))
    }

    // Change the ramp preset schedule.
    if (body.rampPreset !== undefined) {
      if (body.rampPreset !== 'CONSERVATIVE' && body.rampPreset !== 'STANDARD' && body.rampPreset !== 'AGGRESSIVE') {
        return NextResponse.json({ error: 'rampPreset must be CONSERVATIVE, STANDARD or AGGRESSIVE' }, { status: 400 })
      }
      return NextResponse.json(await setMailboxRampPreset({ organizationId: ctx.org.id, mailboxId: id, rampPreset: body.rampPreset }))
    }

    // Resume: clear a circuit-breaker auto-pause (human-only; there is no auto-resume).
    if (body.resume === true) {
      const mailbox = await resumeMailbox({ organizationId: ctx.org.id, mailboxId: id })
      return NextResponse.json(mailbox)
    }

    if (typeof body.warmupEnabled === 'boolean') {
      const mailbox = await setMailboxWarmup({
        organizationId: ctx.org.id,
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
