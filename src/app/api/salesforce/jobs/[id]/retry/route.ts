import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveMember()
  if (!ctx) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  const { id } = await params

  try {
    const updated = await prisma.salesforceSyncJob.updateMany({
      where: { id, organizationId: ctx.org.id, status: 'FAILED' },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    })
    if (updated.count === 0) {
      return NextResponse.json({ error: 'Job not found.' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[POST /api/salesforce/jobs/[id]/retry]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
