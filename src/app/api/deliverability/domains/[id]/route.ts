import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { resolveOrganization } from '@/lib/auth/resolve-organization'

const EARLIEST = new Date('1985-01-01T00:00:00Z') // first .com registrations

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })
  const { id } = await params

  const body = (await request.json().catch(() => null)) as { registeredAt?: unknown } | null
  const raw = body?.registeredAt
  const date = typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T00:00:00Z`) : null
  if (
    !date ||
    Number.isNaN(date.getTime()) ||
    date > new Date() ||
    date < EARLIEST ||
    date.toISOString().slice(0, 10) !== raw
  ) {
    return NextResponse.json({ error: 'registeredAt must be a past date (YYYY-MM-DD)' }, { status: 400 })
  }

  try {
    const org = await resolveOrganization(orgId)
    const result = await prisma.domainHealth.updateMany({
      where: { id, organizationId: org.id },
      data: { registeredAt: date, registeredAtSource: 'manual' },
    })
    if (result.count === 0) return NextResponse.json({ error: 'Domain not found' }, { status: 404 })
    return NextResponse.json({ registeredAt: date.toISOString(), registeredAtSource: 'manual' })
  } catch (err) {
    console.error('[PATCH /api/deliverability/domains/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
