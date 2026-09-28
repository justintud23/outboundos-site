import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'
import { checkDomain, RECHECK_MIN_INTERVAL_MS } from '@/features/deliverability/server/domain-health'

export const maxDuration = 30

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  try {
    const { id } = await params

    const row = await prisma.domainHealth.findFirst({ where: { id, organizationId: ctx.org.id } })
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
