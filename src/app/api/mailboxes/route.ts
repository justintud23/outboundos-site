import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getMailboxes } from '@/features/mailboxes/server/get-mailboxes'
import { createMailbox } from '@/features/mailboxes/server/create-mailbox'
import { MailboxAlreadyExistsError } from '@/features/mailboxes/types'

export async function GET() {
  const { orgId } = await auth()

  if (!orgId) {
    return NextResponse.json(
      { error: 'No active organization. Select an organization to continue.' },
      { status: 403 },
    )
  }

  const org = await resolveOrganization(orgId)
  const mailboxes = await getMailboxes(org.id)
  return NextResponse.json(mailboxes)
}

export async function POST(request: Request) {
  const { orgId } = await auth()

  if (!orgId) {
    return NextResponse.json(
      { error: 'No active organization. Select an organization to continue.' },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (
    !body ||
    typeof body !== 'object' ||
    typeof (body as Record<string, unknown>).email !== 'string' ||
    typeof (body as Record<string, unknown>).displayName !== 'string'
  ) {
    return NextResponse.json(
      { error: 'email and displayName are required' },
      { status: 400 },
    )
  }

  const { email, displayName } = body as { email: string; displayName: string }

  if (!email.includes('@')) {
    return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
  }

  if (!displayName.trim()) {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 })
  }

  try {
    const org = await resolveOrganization(orgId)
    const mailbox = await createMailbox({ organizationId: org.id, email, displayName })
    return NextResponse.json(mailbox, { status: 201 })
  } catch (err) {
    if (err instanceof MailboxAlreadyExistsError) {
      return NextResponse.json(
        { code: 'MAILBOX_ALREADY_EXISTS', error: err.message },
        { status: 409 },
      )
    }
    console.error('[POST /api/mailboxes]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
