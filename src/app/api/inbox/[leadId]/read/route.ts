import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { markThreadRead } from '@/features/inbox/server/mark-thread-read'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leadId } = await params
  const org = await resolveOrganization(orgId)

  let body: { isRead?: boolean }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (typeof body.isRead !== 'boolean') {
    return NextResponse.json({ error: 'isRead (boolean) is required' }, { status: 400 })
  }

  const result = await markThreadRead({
    organizationId: org.id,
    leadId,
    isRead: body.isRead,
  })

  return NextResponse.json(result)
}
