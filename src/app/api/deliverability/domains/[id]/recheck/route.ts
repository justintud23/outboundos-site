import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { checkDomain, RECHECK_MIN_INTERVAL_MS } from '@/features/deliverability/server/domain-health'

export const maxDuration = 30

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  try {
    const { id } = await params
    const org = await resolveOrganization(orgId)

    const row = await prisma.domainHealth.findFirst({ where: { id, organizationId: org.id } })
    if (!row) return NextResponse.json({ error: 'Domain not found' }, { status: 404 })

    const sinceLast = row.lastAttemptAt ? Date.now() - row.lastAttemptAt.getTime() : Infinity
    if (sinceLast < RECHECK_MIN_INTERVAL_MS) {
      return NextResponse.json(
        { error: 'Checked moments ago — try again shortly.', retryAfterSeconds: Math.ceil((RECHECK_MIN_INTERVAL_MS - sinceLast) / 1000) },
        { status: 429 },
      )
    }
    const updated = await checkDomain(row.id)
    return NextResponse.json({ status: updated.status, lastError: updated.lastError })
  } catch (err) {
    console.error('[POST /api/deliverability/domains/[id]/recheck]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
