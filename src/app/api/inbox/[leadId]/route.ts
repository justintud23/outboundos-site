import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getThreadDetail } from '@/features/inbox/server/get-thread-detail'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ leadId: string }> },
) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { leadId } = await params
  const org = await resolveOrganization(orgId)

  try {
    const detail = await getThreadDetail({ organizationId: org.id, leadId })
    return NextResponse.json(detail)
  } catch (err) {
    if (err instanceof Error && err.message === 'Lead not found') {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }
    throw err
  }
}
