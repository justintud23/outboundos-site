import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { getNextActions } from '@/features/actions/server/get-next-actions'

export async function GET() {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const org = await resolveOrganization(orgId)
  const actions = await getNextActions({ organizationId: org.id })

  return NextResponse.json({ actions })
}
