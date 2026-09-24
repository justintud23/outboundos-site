import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { importGraphMailboxes } from '@/features/integrations/server/microsoft'

const MAX_USERS = 50

interface GraphUserInput {
  id: string
  email: string
  displayName: string
}

function isGraphUserInput(v: unknown): v is GraphUserInput {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as Record<string, unknown>).id === 'string' &&
    typeof (v as Record<string, unknown>).email === 'string' &&
    typeof (v as Record<string, unknown>).displayName === 'string'
  )
}

export async function POST(request: Request) {
  const { orgId } = await auth()
  if (!orgId) return NextResponse.json({ error: 'No active organization.' }, { status: 403 })

  const org = await resolveOrganization(orgId)
  if (!org.msTenantId) {
    return NextResponse.json({ error: 'Microsoft 365 not connected' }, { status: 409 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const users = body && typeof body === 'object' ? (body as Record<string, unknown>).users : undefined

  if (!Array.isArray(users) || users.length === 0 || users.length > MAX_USERS || !users.every(isGraphUserInput)) {
    return NextResponse.json(
      { error: `users must be a non-empty array of at most ${MAX_USERS} { id, email, displayName } objects` },
      { status: 400 },
    )
  }

  const result = await importGraphMailboxes(org.id, users)
  return NextResponse.json(result, { status: 201 })
}
