import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { ingestReply } from '@/features/replies/server/ingest-reply'
import { LeadNotFoundByEmailError } from '@/features/replies/types'

export async function POST(request: Request) {
  const { orgId, userId } = await auth()

  if (!orgId || !userId) {
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

  const { fromEmail, rawBody, inReplyToSgMessageId, receivedAt: receivedAtRaw } =
    body as {
      fromEmail: string
      rawBody: string
      inReplyToSgMessageId?: string
      receivedAt?: string
    }

  if (!fromEmail || typeof fromEmail !== 'string' || !rawBody || typeof rawBody !== 'string') {
    return NextResponse.json(
      { error: 'fromEmail and rawBody are required' },
      { status: 400 },
    )
  }

  let receivedAt: Date | undefined
  if (receivedAtRaw !== undefined) {
    receivedAt = new Date(receivedAtRaw)
    if (isNaN(receivedAt.getTime())) {
      return NextResponse.json(
        { error: 'receivedAt must be a valid ISO 8601 date string' },
        { status: 400 },
      )
    }
  }

  const org = await resolveOrganization(orgId)

  try {
    const reply = await ingestReply({
      organizationId: org.id,
      fromEmail,
      rawBody,
      inReplyToSgMessageId,
      receivedAt,
    })
    return NextResponse.json(reply, { status: 201 })
  } catch (err) {
    if (err instanceof LeadNotFoundByEmailError) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[POST /api/replies]', err)
    return NextResponse.json(
      {
        error: process.env.NODE_ENV === 'development' ? message : 'Internal server error',
      },
      { status: 500 },
    )
  }
}
