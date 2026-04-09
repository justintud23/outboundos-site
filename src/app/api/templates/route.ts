import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { resolveOrganization } from '@/lib/auth/resolve-organization'
import { createTemplate } from '@/features/templates/server/create-template'

export async function POST(request: Request) {
  const { orgId } = await auth()
  if (!orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { name?: string; promptType?: string; body?: string; notes?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.name || !body.promptType || !body.body) {
    return NextResponse.json({ error: 'name, promptType, and body are required' }, { status: 400 })
  }

  const validTypes = ['LEAD_SCORING', 'EMAIL_DRAFT', 'REPLY_CLASSIFICATION', 'SUBJECT_LINE']
  if (!validTypes.includes(body.promptType)) {
    return NextResponse.json({ error: `promptType must be one of: ${validTypes.join(', ')}` }, { status: 400 })
  }

  const org = await resolveOrganization(orgId)

  const template = await createTemplate({
    organizationId: org.id,
    name: body.name,
    promptType: body.promptType as 'LEAD_SCORING' | 'EMAIL_DRAFT' | 'REPLY_CLASSIFICATION' | 'SUBJECT_LINE',
    body: body.body,
    notes: body.notes,
  })

  return NextResponse.json(template, { status: 201 })
}
