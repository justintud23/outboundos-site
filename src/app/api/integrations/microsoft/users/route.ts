import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { listTenantUsers } from '@/lib/email/graph/mail'
import { prisma } from '@/lib/db/prisma'

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const org = await resolveOrganization(orgId)
  if (!org.msTenantId) {
    return NextResponse.json({ error: 'Microsoft 365 not connected' }, { status: 409 })
  }

  let users: { id: string; email: string; displayName: string }[]
  try {
    users = await listTenantUsers(org.msTenantId)
  } catch (err) {
    console.error('[GET /api/integrations/microsoft/users]', err)
    return NextResponse.json(
      { error: 'Could not list Microsoft 365 users. Check admin consent.' },
      { status: 502 },
    )
  }

  const existingMailboxes = await prisma.mailbox.findMany({
    where: { organizationId: org.id },
    select: { email: true },
  })
  const excluded = new Set(
    [process.env.MS_NOTIFY_MAILBOX, ...existingMailboxes.map((m) => m.email)]
      .filter((e): e is string => Boolean(e))
      .map((e) => e.toLowerCase()),
  )

  const filtered = users.filter((u) => !excluded.has(u.email.toLowerCase()))
  return NextResponse.json(filtered)
}
