import { NextResponse } from 'next/server'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { setMailboxWarmup } from '@/features/mailboxes/server/set-mailbox-warmup'
import { resumeMailbox } from '@/features/mailboxes/server/resume-mailbox'
import { setMailboxRampPreset, restartMailboxRamp } from '@/features/mailboxes/server/set-mailbox-ramp'
import { MailboxNotFoundError, toMailboxDTO } from '@/features/mailboxes/types'
import { assignOwner, InvalidOwnerError } from '@/features/team/server/assign-owner'
import { prisma } from '@/lib/db/prisma'

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

  let body: { warmupEnabled?: unknown; resume?: unknown; rampPreset?: unknown; restartRamp?: unknown; ownerId?: unknown }
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

    // Assign (or clear) the mailbox's owner.
    if (body.ownerId !== undefined) {
      if (body.ownerId !== null && typeof body.ownerId !== 'string') {
        return NextResponse.json({ error: 'ownerId must be a string or null' }, { status: 400 })
      }
      const found = await assignOwner(ctx.org.id, 'mailbox', id, body.ownerId)
      if (!found) {
        return NextResponse.json({ error: 'Mailbox not found.' }, { status: 404 })
      }
      const updated = await prisma.mailbox.findUniqueOrThrow({ where: { id } })
      return NextResponse.json(toMailboxDTO(updated))
    }

    return NextResponse.json(
      { error: 'Provide warmupEnabled (boolean), resume: true, restartRamp: true, rampPreset (CONSERVATIVE, STANDARD, AGGRESSIVE), or ownerId (string or null)' },
      { status: 400 },
    )
  } catch (err) {
    if (err instanceof InvalidOwnerError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    if (err instanceof MailboxNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    console.error('[PATCH /api/mailboxes/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
