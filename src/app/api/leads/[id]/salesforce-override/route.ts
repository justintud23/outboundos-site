import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { resolveMember } from '@/lib/auth/resolve-member'
import { denyUnlessAdmin } from '@/lib/auth/permission-response'

/** Admin-only: allow a lead past a Salesforce block. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await resolveMember()
  if (!ctx) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const denied = denyUnlessAdmin(ctx)
  if (denied) return denied

  const { id } = await params

  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: ctx.org.id },
    select: { sfCheckStatus: true },
  })

  const updated = await prisma.lead.updateMany({
    where: { id, organizationId: ctx.org.id },
    data: { sfBlockOverride: true, sfHeldSince: null },
  })

  if (updated.count === 0) {
    return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })
  }

  await prisma.auditLog.create({
    data: {
      organizationId: ctx.org.id,
      actorClerkId: ctx.member.clerkUserId,
      action: 'lead.salesforce_override',
      entityType: 'Lead',
      entityId: id,
      metadata: { checkStatus: lead?.sfCheckStatus ?? null },
    },
  })

  return NextResponse.json({ ok: true })
}
