import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { setMailboxWarmup } from '@/features/mailboxes/server/set-mailbox-warmup'
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

  let body: { warmupEnabled?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.warmupEnabled !== 'boolean') {
    return NextResponse.json({ error: 'warmupEnabled (boolean) is required' }, { status: 400 })
  }

  try {
    const org = await resolveOrganization(orgId)
    const mailbox = await setMailboxWarmup({
      organizationId: org.id,
      mailboxId: id,
      warmupEnabled: body.warmupEnabled,
    })
    return NextResponse.json(mailbox)
  } catch (err) {
    if (err instanceof MailboxNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 })
    }
    console.error('[PATCH /api/mailboxes/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
